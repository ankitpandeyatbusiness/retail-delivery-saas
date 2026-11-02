// Bulk orders (step 1: request and quote; the advance and balance payments come next).
// The customer picks dishes and quantities from the whole menu; the owner sends a quote; the customer accepts (next step).
//  - every price is worked out HERE, from the menu; the app only sends what was picked
//  - a dish with a bulk price (Product.bulk: minQty + percentOff) gets it when the pieces of that dish, all options together, reach minQty
//  - the minimum order amount, the notice time and the bulk delivery fee are the shop's bulk settings (BulkSettings)
const crypto = require('crypto');
const mongoose = require('mongoose');
const BulkSettings = require('../models/BulkSettings');
const BulkOrder = require('../models/BulkOrder');
const { groupKind } = require('./optionGroups');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Address = require('../models/Address');
const User = require('../models/User');
const { resolveConfig } = require('./tenantConfigService');
const { buildLines, applyTax, computeTotals, round2 } = require('./orderPricing');
const { foodModeFilter } = require('./catalogQuery');
const { haversineKm } = require('../utils/geo');
const { httpError } = require('../middlewares/apiErrors');

const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const DAY = 86400000;
const MAX_LINES = 60;
const OPEN = ['requested', 'quoted', 'expired'];   // nothing paid yet: the customer can still cancel
// a customer's or a shop's own words inside a notification: the first part, then "..." when it is long
const clip = (s, n = 100) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const rupees = (n) => `₹${+Number(n || 0).toFixed(2)}`;

/* ------------------------------ settings ------------------------------ */
const DEFAULTS = { enabled: false, paused: false, minOrderAmount: 0, noticeHours: 24, maxQtyPerDish: 500, pickup: true, delivery: true, deliveryFee: { type: 'free' }, packagingCharge: 0, advancePercent: 50, quoteValidHours: 24, fullRefundHours: 18 };

// What the "Recommended settings" button fills in (the owner's rules screen and the super admin's). It does not switch bulk ordering on or off.
// The apps only apply what the server sends, so the numbers live in one place.
const RECOMMENDED = {
    minOrderAmount: 3000, noticeHours: 24, maxQtyPerDish: 500, pickup: true, delivery: true,
    deliveryFee: { type: 'free_above', amount: 200, freeAbove: 10000 },
    packagingCharge: 0, advancePercent: 50, quoteValidHours: 24, fullRefundHours: 18,
};

async function settingsOf(tenantId) {
    const s = await BulkSettings.findOne({ tenantId }).lean();
    return { ...DEFAULTS, ...(s || {}), deliveryFee: { ...DEFAULTS.deliveryFee, ...(s?.deliveryFee || {}) } };
}

const num = (v, lo, hi, what) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw httpError(400, `${what} must be a number from ${lo} to ${hi}`);
    return v;
};

// the owner saves the rules; only known fields are taken
async function saveSettings(tenantId, body = {}) {
    const set = {};
    if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw httpError(400, 'enabled must be true or false'); set.enabled = body.enabled; }
    if (body.paused !== undefined) { if (typeof body.paused !== 'boolean') throw httpError(400, 'paused must be true or false'); set.paused = body.paused; }
    if (body.minOrderAmount !== undefined) set.minOrderAmount = num(body.minOrderAmount, 0, 1000000, 'The minimum order amount');
    if (body.noticeHours !== undefined) set.noticeHours = num(body.noticeHours, 0, 720, 'The notice time');
    if (body.maxQtyPerDish !== undefined) set.maxQtyPerDish = Math.round(num(body.maxQtyPerDish, 2, 10000, 'The most pieces of one dish'));
    for (const k of ['pickup', 'delivery']) if (body[k] !== undefined) { if (typeof body[k] !== 'boolean') throw httpError(400, `${k} must be true or false`); set[k] = body[k]; }
    if (body.packagingCharge !== undefined) set.packagingCharge = num(body.packagingCharge, 0, 5000, 'The packaging charge');
    if (body.advancePercent !== undefined) set.advancePercent = num(body.advancePercent, 10, 100, 'The advance');
    if (body.quoteValidHours !== undefined) set.quoteValidHours = Math.round(num(body.quoteValidHours, 1, 168, 'The quote validity'));
    if (body.fullRefundHours !== undefined) set.fullRefundHours = Math.round(num(body.fullRefundHours, 0, 720, 'The full refund time'));
    if (body.deliveryFee !== undefined) {
        const d = body.deliveryFee;
        if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError(400, 'The delivery fee must be an object');
        if (d.type !== undefined && !['free', 'flat', 'free_above', 'distance'].includes(d.type)) throw httpError(400, 'Unknown delivery fee type');
        const lim = { amount: [0, 5000], freeAbove: [0, 1000000], baseKm: [0, 100], baseFee: [0, 5000], perKmFee: [0, 500], maxFee: [0, 5000] };
        const fee = {};
        if (d.type !== undefined) fee.type = d.type;
        for (const [k, [lo, hi]] of Object.entries(lim)) if (d[k] !== undefined) fee[k] = num(d[k], lo, hi, `The delivery fee ${k}`);
        for (const [k, v] of Object.entries(fee)) set[`deliveryFee.${k}`] = v;
    }
    await BulkSettings.updateOne({ tenantId }, { $set: set, $setOnInsert: { tenantId } }, { upsert: true });
    return settingsOf(tenantId);
}

// what the customer app needs to know (no private numbers)
const publicConfig = (s) => ({
    enabled: s.enabled, paused: !!s.paused, minOrderAmount: s.minOrderAmount, noticeHours: s.noticeHours, maxQtyPerDish: s.maxQtyPerDish,
    pickup: s.pickup, delivery: s.delivery, deliveryFee: s.deliveryFee, packagingCharge: s.packagingCharge,
    advancePercent: s.advancePercent, quoteValidHours: s.quoteValidHours, fullRefundHours: s.fullRefundHours,
});

async function needSettings(tenant) {
    if (!require('./featureGate').isOn(tenant, 'bulkOrders')) throw httpError(404, 'Bulk orders are not available at this shop');   // the super admin's switch
    const s = await settingsOf(tenant._id);
    if (!s.enabled) throw httpError(404, 'Bulk orders are not available at this shop');
    if (s.paused) throw httpError(409, require('./featureGate').UNAVAILABLE);   // paused by the owner: no new request (orders already taken carry on)
    return s;
}

// A dish's bulk price as the editor sends it: null clears it, otherwise both numbers are checked. Returns what is stored.
// (Used by the owner's menu route and the super admin's, so both refuse the same nonsense.)
function cleanBulkPrice(b) {
    if (b === undefined || b === null) return b;
    if (typeof b !== 'object' || !Number.isInteger(b.minQty) || b.minQty < 2 || b.minQty > 10000) throw httpError(400, 'Bulk price: the minimum quantity must be a whole number from 2 to 10000');
    if (typeof b.percentOff !== 'number' || !(b.percentOff > 0) || b.percentOff > 90) throw httpError(400, 'Bulk price: the discount must be more than 0 and at most 90 percent');
    return { minQty: b.minQty, percentOff: Math.round(b.percentOff * 100) / 100 };
}

/* ------------------------------ the menu for the bulk screen ------------------------------ */
// The whole menu with every option and the bulk price of each dish. Dishes sold by weight are not here: bulk counts pieces.
async function menuFor(tenant) {
    const config = resolveConfig(tenant);
    const cats = await Category.find({ tenantId: tenant._id, isActive: true }).sort({ sortOrder: 1, _id: 1 }).select('name').lean();
    const products = await Product.find({
        tenantId: tenant._id, isActive: true, isAvailable: { $ne: false }, sellBy: { $in: ['piece', null] }, categoryId: { $in: cats.map((c) => c._id) },
        ...foodModeFilter(config.home.foodMode),
    }).sort({ sortOrder: 1, _id: 1 }).select('categoryId name description image isVeg price optionGroups bulk bulkMin serves').lean();
    return {
        categories: cats.map((c) => ({
            id: String(c._id), name: c.name,
            items: products.filter((p) => String(p.categoryId) === String(c._id)).map((p) => ({
                id: String(p._id), name: p.name, description: p.description, image: p.image, isVeg: p.isVeg, price: p.price, serves: p.serves,
                bulkMin: p.bulkMin || 0,
                optionGroups: (p.optionGroups || []).map((g) => ({ ...g, kind: groupKind(g) })), bulk: p.bulk?.minQty ? { minQty: p.bulk.minQty, percentOff: p.bulk.percentOff } : null,
            })),
        })).filter((c) => c.items.length),
    };
}

/* ------------------------------ pricing a request ------------------------------ */
// Works out what the customer would pay. Nothing is saved. `problems` lists what stops it from being sent (the screen shows them live).
async function priceRequest({ tenant, userId, body = {}, settings }) {
    const s = settings || await needSettings(tenant);
    const config = resolveConfig(tenant);
    const problems = [];
    const problem = (code, message) => problems.push({ code, message });

    const fulfilment = body.fulfilment;
    if (!['delivery', 'pickup'].includes(fulfilment)) throw httpError(400, 'Choose pickup or delivery');
    if (!s[fulfilment]) throw httpError(400, fulfilment === 'delivery' ? 'This shop does not deliver bulk orders' : 'This shop does not take bulk orders for pickup');

    const when = new Date(body.when);
    if (Number.isNaN(when.getTime())) throw httpError(400, 'Choose the date and time');
    if (when.getTime() > Date.now() + 180 * DAY) throw httpError(400, 'Choose a date within the next 6 months');
    if (when.getTime() < Date.now() + s.noticeHours * 3600000) problem('notice', `This shop needs ${s.noticeHours} hours' notice. Choose a later time.`);

    let address = null;
    if (fulfilment === 'delivery') {
        if (!isId(String(body.addressId || ''))) throw httpError(400, 'Choose the delivery address');
        address = await Address.findOne({ _id: body.addressId, tenantId: tenant._id, userId }).lean();
        if (!address) throw httpError(400, 'Address not found');
    }
    const shopAt = tenant.delivery || {};
    const distanceKm = address && [shopAt.latitude, shopAt.longitude, address.latitude, address.longitude].every(Number.isFinite)
        ? Math.round(haversineKm(shopAt.latitude, shopAt.longitude, address.latitude, address.longitude) * 10) / 10 : null;

    const built = await buildLines(tenant, config, body.items, when, { bulk: true, maxQty: s.maxQtyPerDish, maxLines: MAX_LINES });
    const lines = built.lines;

    // the bulk price: pieces of one dish, all its options together
    const prods = await Product.find({ _id: { $in: lines.map((l) => l.productId) } }).select('name bulk bulkMin optionGroups').lean();
    const bulkOf = new Map(prods.map((p) => [String(p._id), p.bulk]));
    const pieces = new Map();
    for (const l of lines) pieces.set(String(l.productId), (pieces.get(String(l.productId)) || 0) + l.quantity);
    let subtotal = 0;
    for (const l of lines) {
        const b = bulkOf.get(String(l.productId));
        l.listPrice = l.unitPrice;
        if (b?.minQty && b.percentOff > 0 && pieces.get(String(l.productId)) >= b.minQty) {
            l.unitPrice = round2(l.listPrice * (1 - b.percentOff / 100));
            l.lineTotal = round2(l.unitPrice * l.quantity);
            l.bulkApplied = true;
        }
        subtotal += l.lineTotal;
    }
    subtotal = round2(subtotal);
    // The least a person must order: set by the owner on each CHOICE (Half 20, Full 10) or on a dish with no choices. Add-ons never have one, and the pieces of one
    // choice count together whatever add-ons they carry (15 Half with mint + 10 Half with cheese = 25 Half).
    for (const p of prods) {
        const choices = (p.optionGroups || []).filter((g) => groupKind(g) === 'choice');
        const mine = lines.filter((l) => String(l.productId) === String(p._id));
        if (!choices.length) {
            const have = mine.reduce((n, l) => n + l.quantity, 0);
            if (p.bulkMin > 0 && have < p.bulkMin) problem('min_qty', `${p.name}: at least ${p.bulkMin} pieces (you have ${have})`);
            continue;
        }
        for (const g of choices) {
            for (const o of g.options || []) {
                if (!(o.bulkMin > 0)) continue;
                const have = mine.filter((l) => (l.selections || []).some((x) => x.groupId === g.id && (x.optionId === o.id))).reduce((n, l) => n + l.quantity, 0);
                if (have > 0 && have < o.bulkMin) problem('min_qty', `${p.name} (${o.name}): at least ${o.bulkMin} pieces (you have ${have})`);
            }
        }
    }
    if (subtotal < s.minOrderAmount) problem('minimum', `The minimum bulk order is ${rupees(s.minOrderAmount)}. Add ${rupees(round2(s.minOrderAmount - subtotal))} more.`);

    const gstMode = config.orders.gst?.mode || 'none';
    const tax = applyTax(lines, { mode: gstMode, discount: 0, subtotal });
    const splitTax = lines.reduce((a, l) => {
        const own = l.gstInclusive === true ? 'inclusive' : l.gstInclusive === false ? 'exclusive' : gstMode;
        if (gstMode === 'none') return a;
        if (own === 'exclusive') a.onTop += l.tax || 0; else a.inside += l.tax || 0;
        return a;
    }, { onTop: 0, inside: 0 });
    const totals = computeTotals(
        { deliveryFee: s.deliveryFee, packagingCharge: s.packagingCharge, gst: config.orders.gst },
        { orderType: fulfilment, subtotal, discount: 0, tip: 0, tax, taxOnTop: round2(splitTax.onTop), taxIncluded: round2(splitTax.inside), distanceKm },
    );
    const pricing = {
        subtotal, discount: 0, deliveryFee: totals.deliveryFee, packagingCharge: totals.packagingCharge, tax: totals.tax,
        taxOnTop: totals.taxOnTop, taxIncluded: totals.taxIncluded, taxMode: totals.taxMode, taxPercent: totals.taxPercent, total: totals.total,
    };
    return { fulfilment, when, address, distanceKm, lines, pricing, gstMode, problems, bulkSaved: round2(lines.reduce((n, l) => n + (l.bulkApplied ? (l.listPrice - l.unitPrice) * l.quantity : 0), 0)) };
}

// what the app shows while the customer is still picking (no saving)
async function estimate({ tenant, userId, body }) {
    const r = await priceRequest({ tenant, userId, body });
    return { lines: r.lines.map(lineView), pricing: r.pricing, problems: r.problems, bulkSaved: r.bulkSaved, canSend: r.problems.length === 0 };
}

// the choices of a line the way the builder wants them ([{ groupId, optionIds }]), so "Order again" can fill it in
const pickOf = (sel) => { const by = new Map(); for (const x of sel || []) { if (x?.groupId && x?.optionId) by.set(x.groupId, [...(by.get(x.groupId) || []), x.optionId]); } return [...by].map(([groupId, optionIds]) => ({ groupId, optionIds })); };
const lineView = (l) => ({
    id: l._id ? String(l._id) : undefined, productId: String(l.productId), name: l.name, image: l.image, isVeg: l.isVeg, quantity: l.quantity,
    listPrice: l.listPrice, unitPrice: l.unitPrice, bulkApplied: !!l.bulkApplied, lineTotal: l.lineTotal, tax: l.tax,
    options: (l.selections || []).map((x) => x.optionName || x.name).filter(Boolean),
    pick: pickOf(l.selections),
});

/* ------------------------------ the customer ------------------------------ */
const newCode = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();

async function create({ tenant, userId, body = {} }) {
    const user = await User.findById(userId).select('name phone role').lean();
    if (user && user.role !== 'customer') throw httpError(403, 'Shop owners and riders cannot place orders. Please use a customer number.');
    const settings = await needSettings(tenant);
    const r = await priceRequest({ tenant, userId, body, settings });
    if (r.problems.length) throw httpError(400, r.problems[0].message);

    const c = body.contact || {};
    const name = String(c.name || user?.name || '').trim().slice(0, 80);
    const phone = String(c.phone || user?.phone || '').trim().slice(0, 20);
    if (!name) throw httpError(400, 'Please enter the contact person');
    if (!/^[0-9+\-\s]{6,20}$/.test(phone)) throw httpError(400, 'Please enter a phone number');
    const gstin = String(c.gstin || '').trim().toUpperCase().slice(0, 15);
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw httpError(400, 'The GST number must be 15 letters and digits');
    if (body.cutlery !== undefined && typeof body.cutlery !== 'boolean') throw httpError(400, 'Cutlery must be yes or no');
    const packaging = body.packaging === undefined ? 'any' : body.packaging;
    if (!['boxes', 'trays', 'any'].includes(packaging)) throw httpError(400, 'Choose boxes or trays');

    // a double tap does not send two
    const dup = await BulkOrder.findOne({ tenantId: tenant._id, userId, status: 'requested', fulfilment: r.fulfilment, when: r.when, 'pricing.total': r.pricing.total, createdAt: { $gt: new Date(Date.now() - 60000) } }).lean();
    if (dup) return { duplicate: true, order: dup };

    const a = r.address;
    let doc;
    for (let i = 0; i < 5 && !doc; i += 1) {
        try {
            doc = await BulkOrder.create({
                tenantId: tenant._id, userId, code: newCode(), fulfilment: r.fulfilment, when: r.when,
                address: a ? { label: a.label, name: a.name || name, phone: a.phone || phone, line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, pincode: a.pincode, latitude: a.latitude, longitude: a.longitude } : undefined,
                distanceKm: r.distanceKm ?? undefined,
                contact: { name, phone, onSitePhone: String(c.onSitePhone || '').trim().slice(0, 20) || undefined, company: String(c.company || '').trim().slice(0, 100) || undefined, gstin: gstin || undefined },
                cutlery: body.cutlery === true, packaging, note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : undefined,
                foodNote: typeof body.foodNote === 'string' && body.foodNote.trim() ? body.foodNote.trim().slice(0, 200) : undefined,
                deliveryNote: r.fulfilment === 'delivery' && typeof body.deliveryNote === 'string' && body.deliveryNote.trim() ? body.deliveryNote.trim().slice(0, 300) : undefined,
                gstMode: r.gstMode, lines: r.lines, pricing: r.pricing, history: [{ status: 'requested', by: 'customer' }],
            });
        } catch (e) { if (e.code !== 11000) throw e; }   // the short code was taken: make another
    }
    if (!doc) throw httpError(503, 'Could not save the request. Please try again.');
    tell('bulk_new', { tenantId: tenant._id, vars: { name, code: doc.code, total: doc.pricing.total, when: r.when.toISOString().slice(0, 10) }, data: { kind: 'bulk', bulkId: String(doc._id) } });
    return { duplicate: false, order: doc.toObject() };
}

// a quote that ran out is shown (and treated) as expired
const effectiveStatus = (o, now = new Date()) => (o.status === 'quoted' && o.quote?.validUntil && new Date(o.quote.validUntil) < now ? 'expired' : o.status);

function customerView(o) {
    const status = effectiveStatus(o);
    return {
        id: String(o._id), code: o.code, status, fulfilment: o.fulfilment, when: o.when, address: o.address, contact: o.contact, cutlery: o.cutlery, packaging: o.packaging, note: o.note, foodNote: o.foodNote, deliveryNote: o.deliveryNote,
        lines: (o.lines || []).map(lineView), pricing: o.pricing, changeNote: o.changeNote, declineReason: o.declineReason,
        quote: o.quote?.pricing ? {
            version: o.quote.version, lines: (o.quote.lines || []).map(lineView), pricing: o.quote.pricing, advancePercent: o.quote.advancePercent, fullRefundHours: o.quote.fullRefundHours,
            advancePaise: o.quote.advancePaise, balancePaise: o.quote.balancePaise, validUntil: o.quote.validUntil, note: o.quote.note, quotedAt: o.quote.quotedAt,
        } : null,
        payment: o.payment?.advancePaymentId ? {
            advancePaise: o.payment.advancePaise, paidAt: o.payment.paidAt, kept: !!o.payment.advanceKept, refundPaise: o.payment.refundPaise, refundStatus: o.payment.refundStatus,
            balancePaid: !!o.payment.balancePaid, balancePaise: o.payment.balancePaid ? o.payment.balancePaise : undefined, balanceVia: o.payment.balanceVia, balancePaidAt: o.payment.balancePaidAt,
        } : null,
        canPay: status === 'quoted', cancel: cancelOutcome(o), cancelledBy: o.cancelledBy, cancelReason: o.cancelReason,
        trackOrderId: o.orderId && o.fulfilment === 'delivery' && ['ready', 'out_for_delivery'].includes(status) ? String(o.orderId) : undefined,   // the delivery itself, to follow the rider live
        balance: balanceDue(o), stageAt: o.stageAt, completedAt: o.completedAt, invoiceReady: o.status === 'completed',
        createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
}

/* ------------------------------ the balance ------------------------------ */
const HANDOVER = ['ready', 'out_for_delivery', 'delivered'];   // the balance is paid when the order is ready for pickup, at the door, or just handed over

// Can the customer pay the balance online right now, and how much? ({ ok, paise, message })
function balanceDue(o) {
    const paise = o.quote?.balancePaise || 0;
    const no = (message) => ({ ok: false, paise, message });
    if (!o.payment?.advancePaymentId) return no('The advance has not been paid yet');
    if (!HANDOVER.includes(o.status)) return no('The balance is paid when the order is ready or delivered');
    if (o.payment.balancePaid) return no('The balance is already paid');
    if (paise <= 0) return no('Nothing is left to pay');
    if (paise < 100) return no('The balance is too small to pay online. Please pay the shop in cash.');
    return { ok: true, paise };
}

async function mine({ tenant, userId, id }) {
    if (!isId(String(id))) throw httpError(404, 'Bulk order not found');
    const o = await BulkOrder.findOne({ _id: id, tenantId: tenant._id, userId }).lean();
    if (!o) throw httpError(404, 'Bulk order not found');
    return o;
}

async function listMine({ tenant, userId }) {
    const rows = await BulkOrder.find({ tenantId: tenant._id, userId }).sort({ createdAt: -1 }).limit(50).lean();
    return rows.map(customerView);
}

// What a cancel means for the money, by the rule the customer saw in the quote: cancel at least `fullRefundHours` before the time and the whole
// advance goes back; later the shop keeps it. Nothing paid = nothing to refund. One function, used by the real cancel and by the preview.
function cancelOutcome(o, now = new Date()) {
    const paid = o.status === 'confirmed' && !!o.payment?.advancePaymentId;
    const paise = paid ? (o.payment.advancePaise || 0) : 0;
    const hours = o.quote?.fullRefundHours ?? 0;
    const early = new Date(o.when).getTime() - now.getTime() >= hours * 3600000;
    return { paid, refundPaise: paid && early ? paise : 0, keptPaise: paid && !early ? paise : 0, refundHours: hours, canCancel: OPEN.includes(o.status) || paid };
}

async function previewCancel({ tenant, userId, id }) {
    return cancelOutcome(await mine({ tenant, userId, id }));
}

// the customer cancels: before he pays nothing is owed; after the advance the rule above decides
async function cancelByCustomer({ tenant, userId, id }) {
    const o = await mine({ tenant, userId, id });
    if (OPEN.includes(o.status)) {
        const done = await BulkOrder.findOneAndUpdate(
            { _id: o._id, status: { $in: OPEN } },
            { $set: { status: 'cancelled', cancelledBy: 'customer' }, $push: { history: { status: 'cancelled', by: 'customer' } } }, { returnDocument: 'after' },
        ).lean();
        if (!done) throw httpError(409, 'This order can no longer be cancelled here');   // a payment landed a moment ago: open it again
        return customerView(done);
    }
    if (o.status !== 'confirmed') throw httpError(409, 'This order can no longer be cancelled here. Please talk to the shop.');
    const out = cancelOutcome(o);
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: 'confirmed' },
        { $set: { status: 'cancelled', cancelledBy: 'customer', 'payment.advanceKept': out.keptPaise > 0, 'payment.refundDuePaise': out.refundPaise }, $push: { history: { status: 'cancelled', by: 'customer', note: out.refundPaise ? 'refund due' : 'advance kept' } } },
        { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order was just changed. Open it again.');
    await refundDue(done);   // if this fails or the server stops here, the repair job sends it
    if (out.keptPaise > 0) require('./billableService').markBulk(done, 'cancel_kept').catch((e) => console.error('Billable count error:', e.message));   // the shop kept money: it counts for the rent
    tell('bulk_cancelled', { tenantId: tenant._id, vars: { name: done.contact?.name, code: done.code, kept: out.keptPaise > 0 }, data: { kind: 'bulk', bulkId: String(done._id) } });
    await require('./bulkKitchen').closeTicket(done).catch((e) => console.error('Bulk ticket error:', e.message));   // the cook and the rider stop
    return customerView(await BulkOrder.findById(done._id).lean());
}

// sends the refund an ended order is owed (cancelled orders carry the amount in payment.refundDuePaise)
async function refundDue(o) {
    const due = o.payment?.refundDuePaise;
    if (!(due > 0)) return null;
    const bp = require('./bulkPayment');
    let out;
    if (o.cancelledBy === 'owner') out = await bp.refundAllOf(o._id, 'shop_cancel');   // the shop cancelled: everything paid online goes back
    else { const pay = await bp.advanceOf(o._id); out = pay ? await bp.refund(pay._id, { reason: 'customer_cancel', amountPaise: due }) : null; }
    if (out?.ok) await BulkOrder.updateOne({ _id: o._id }, { $set: { 'payment.refundDueDone': true } });
    else if (out?.skipped) {   // somebody else already started or finished it: done when every refund of this order has gone out
        const left = await require('../models/BulkPayment').countDocuments({ bulkId: o._id, 'refund.status': { $exists: true, $ne: 'refunded' } });
        if (!left) await BulkOrder.updateOne({ _id: o._id }, { $set: { 'payment.refundDueDone': true } });
    }
    return out;
}

// the shop cancels an order whose advance is paid (any time before it is delivered): the customer always gets everything back
async function ownerCancel({ tenant, id, reason }) {
    const o = await ownerOne({ tenant, id });
    const text = String(reason || '').trim().slice(0, 300);
    if (!text) throw httpError(400, 'Tell the customer why');
    if (!['confirmed', 'preparing', 'ready', 'out_for_delivery'].includes(o.status)) throw httpError(409, 'This order can no longer be cancelled here');
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: o.status },
        { $set: { status: 'cancelled', cancelledBy: 'owner', cancelReason: text, 'payment.refundDuePaise': (o.payment?.advancePaise || 0) + (o.payment?.balanceVia === 'online' ? o.payment.balancePaise || 0 : 0) }, $push: { history: { status: 'cancelled', by: 'owner', note: text } } },
        { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order was just changed. Open it again.');
    await refundDue(done);
    await require('./bulkKitchen').closeTicket(done).catch((e) => console.error('Bulk ticket error:', e.message));   // the cook and the rider stop
    tell('bulk_shop_cancelled', { tenantId: tenant._id, userId: done.userId, vars: { code: done.code, reason: text, amount: (done.payment?.advancePaise || 0) / 100 }, data: { kind: 'bulk', bulkId: String(done._id) } });
    return ownerView(await BulkOrder.findById(done._id).lean());
}

/* ------------------------------ following the work ticket (services/bulkKitchen.js) ------------------------------ */
const STAGES = ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
// The cook, the rider or the owner moved the work ticket: the bulk order goes to the same stage. Only forward; a repeat changes nothing.
async function advanceFromTicket({ bulkId, to }) {
    const o = await BulkOrder.findById(bulkId).lean();
    if (!o) return null;
    const from = STAGES.indexOf(o.status);
    if (from < 0 || STAGES.indexOf(to) <= from) return o;
    if (to === 'out_for_delivery' && o.fulfilment !== 'delivery') return o;
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: o.status },
        { $set: { status: to, [`stageAt.${to}`]: new Date() }, $push: { history: { status: to, by: 'kitchen' } } }, { returnDocument: 'after' },
    ).lean();
    if (!done) return null;
    tell('bulk_stage', {
        tenantId: done.tenantId, userId: done.userId,
        vars: { code: done.code, stage: to, fulfilment: done.fulfilment, balance: done.payment?.balancePaid ? 0 : (done.quote?.balancePaise || 0) / 100 },
        data: { kind: 'bulk', bulkId: String(done._id) },
    });
    return done;
}

// The balance was collected with the delivery (the rider's cash, or the counter): written down once. Safe to repeat.
async function balanceFromTicket({ bulkId, via = 'cash' }) {
    const o = await BulkOrder.findById(bulkId).lean();
    if (!o || !o.payment?.advancePaymentId || o.payment.balancePaid) return null;
    const paise = o.quote?.balancePaise || 0;
    if (paise <= 0) return null;
    return BulkOrder.findOneAndUpdate(
        { _id: o._id, 'payment.balancePaid': { $ne: true } },
        { $set: { 'payment.balancePaid': true, 'payment.balancePaise': paise, 'payment.balanceVia': via, 'payment.balancePaidAt': new Date() }, $push: { history: { status: 'balance_paid', by: 'kitchen', note: `balance collected (${via})` } } },
        { returnDocument: 'after' },
    ).lean();
}

/* ------------------------------ making it, handing it over, getting the balance ------------------------------ */
// The owner moves a paid order on: confirmed -> preparing -> ready -> (delivery: out for delivery) -> delivered.
// A pickup is "handed over" from ready; a delivery goes out first. The customer hears about every step.
const NEXT = { confirmed: ['preparing'], preparing: ['ready'], ready: ['out_for_delivery', 'delivered'], out_for_delivery: ['delivered'] };

async function setStage({ tenant, id, to }) {
    const o = await ownerOne({ tenant, id });
    const allowed = (NEXT[o.status] || []).includes(to)
        && !(to === 'out_for_delivery' && o.fulfilment !== 'delivery')                       // a pickup does not go out
        && !(to === 'delivered' && o.fulfilment === 'delivery' && o.status === 'ready');     // a delivery goes out first
    if (!allowed) throw httpError(409, `This order is "${o.status.replace(/_/g, ' ')}": it cannot go to "${String(to).replace(/_/g, ' ')}" now`);
    const now = new Date();
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: o.status },
        { $set: { status: to, [`stageAt.${to}`]: now }, $push: { history: { status: to, by: 'owner' } } }, { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order was just changed. Open it again.');
    tell('bulk_stage', {
        tenantId: tenant._id, userId: done.userId,
        vars: { code: done.code, stage: to, fulfilment: done.fulfilment, balance: done.payment?.balancePaid ? 0 : (done.quote?.balancePaise || 0) / 100 },
        data: { kind: 'bulk', bulkId: String(done._id) },
    });
    await require('./bulkKitchen').toTicket(done, to).catch((e) => console.error('Bulk ticket error:', e.message));   // the cook's queue and the rider follow
    if (to === 'delivered') await tryComplete(done._id);
    return ownerView(await BulkOrder.findById(done._id).lean());
}

// The customer paid the balance in cash: the owner marks it received. If the customer already paid it online the answer is "already paid";
// if he is paying online at this very moment, that payment is refunded by itself when it lands (bulkPayment.settleBalance).
async function markCash({ tenant, id }) {
    const o = await ownerOne({ tenant, id });
    if (!o.payment?.advancePaymentId) throw httpError(409, 'The advance has not been paid');
    if (!HANDOVER.includes(o.status)) throw httpError(409, 'The balance is collected when the order is ready or delivered');
    if (o.payment.balancePaid) throw httpError(409, o.payment.balanceVia === 'online' ? 'The customer already paid the balance online' : 'The balance is already marked as received');
    const paise = o.quote?.balancePaise || 0;
    if (paise <= 0) throw httpError(409, 'Nothing is left to collect');
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: { $in: HANDOVER }, 'payment.balancePaid': { $ne: true } },
        { $set: { 'payment.balancePaid': true, 'payment.balancePaise': paise, 'payment.balanceVia': 'cash', 'payment.balancePaidAt': new Date() }, $push: { history: { status: 'balance_paid', by: 'owner', note: 'cash received' } } },
        { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order was just changed. Open it again.');
    await require('./bulkKitchen').ticketPaid(done._id).catch((e) => console.error('Bulk ticket error:', e.message));   // the rider is not asked for it
    await tryComplete(done._id);
    return ownerView(await BulkOrder.findById(done._id).lean());
}

// Delivered and the balance settled (online, cash, or nothing left): the order is completed, and it counts for the rent. Safe to repeat.
async function tryComplete(id) {
    const o = await BulkOrder.findById(id).lean();
    if (!o || o.status !== 'delivered') return null;
    if (!(o.payment?.balancePaid || (o.quote?.balancePaise || 0) <= 0)) return null;
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: 'delivered' },
        { $set: { status: 'completed', completedAt: new Date() }, $push: { history: { status: 'completed', by: 'system' } } }, { returnDocument: 'after' },
    ).lean();
    if (!done) return null;
    await require('./billableService').markBulk(done, 'completed').catch((e) => console.error('Billable count error:', e.message));
    tell('bulk_completed', { tenantId: done.tenantId, userId: done.userId, vars: { code: done.code }, data: { kind: 'bulk', bulkId: String(done._id) } });
    return done;
}

// repair: orders that are delivered and paid but were not completed (a crash), and completed ones that were not counted for the rent
async function repairCompleted(now = new Date()) {
    let n = 0;
    const stuck = await BulkOrder.find({ status: 'delivered', updatedAt: { $lte: new Date(now.getTime() - 2 * 60000) } }).select('_id').limit(50).lean();
    for (const s of stuck) { if (await tryComplete(s._id).catch(() => null)) n += 1; }
    const uncounted = await BulkOrder.find({ status: 'completed', 'billing.billable': { $ne: true }, completedAt: { $gte: new Date(now.getTime() - 2 * 86400000), $lte: new Date(now.getTime() - 2 * 60000) } }).limit(50).lean();
    for (const u of uncounted) { const r = await require('./billableService').markBulk(u, 'completed').catch(() => null); if (r?.marked) n += 1; }
    return n;
}

/* ------------------------------ the invoice ------------------------------ */
// A completed order as the "order" the invoice drawing (services/invoiceService.js) already knows: the quote's prices and tax, the shop's details
// as they are now (the shop's own saved copy is not kept for bulk orders yet), the company and its GST number as the buyer.
async function invoiceFor({ tenant, id, userId }) {
    const o = userId ? await mine({ tenant, userId, id }) : await ownerOne({ tenant, id });
    if (o.status !== 'completed') throw httpError(409, 'The invoice is ready once the order is completed');
    const t = await require('../models/Tenant').findById(o.tenantId).select('name phone address business').lean();
    const q = o.quote;
    const rs2 = (paise) => `Rs. ${(paise / 100).toFixed(2)}`;
    const adv = o.payment?.advancePaise || 0;
    const bal = o.payment?.balancePaid ? (o.payment.balancePaise || 0) : 0;
    return {
        tenant: t,
        order: {
            orderNo: `B${o.code}`, createdAt: o.completedAt || o.updatedAt, orderType: o.fulfilment,
            items: q.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal, gstRate: l.gstRate, gstInclusive: l.gstInclusive, tax: l.tax, selections: (l.selections || []).map((s) => ({ name: s.name })), note: l.note })),
            pricing: { ...q.pricing },
            seller: { name: t?.business?.legalName || t?.name, gstin: t?.business?.gstin, fssai: t?.business?.fssai },
            customer: { name: o.contact?.company || o.contact?.name, phone: o.contact?.phone, gstin: o.contact?.gstin },
            address: o.address,
            payment: { method: 'bulk', label: `Advance online${bal ? `, balance ${o.payment.balanceVia === 'cash' ? 'in cash' : 'online'}` : ''}`, status: 'paid' },
            paidParts: [['Advance paid (online)', rs2(adv)], ...(bal ? [[`Balance paid (${o.payment.balanceVia === 'cash' ? 'cash' : 'online'})`, rs2(bal)]] : [])],
        },
    };
}

// "please change the quote": it goes back to the owner with a note
async function askChange({ tenant, userId, id, note }) {
    const o = await mine({ tenant, userId, id });
    const text = String(note || '').trim().slice(0, 500);
    if (!text) throw httpError(400, 'Tell the shop what to change');
    if (effectiveStatus(o) !== 'quoted' && effectiveStatus(o) !== 'expired') throw httpError(409, 'There is no quote to change');
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: 'quoted' },
        { $set: { status: 'requested', changeNote: text }, $push: { history: { status: 'requested', by: 'customer', note: text } } }, { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This quote can no longer be changed');
    tell('bulk_change', { tenantId: tenant._id, vars: { name: done.contact?.name, code: done.code, note: clip(text) }, data: { kind: 'bulk', bulkId: String(done._id) } });
    return customerView(done);
}

/* ------------------------------ the owner ------------------------------ */
function ownerView(o) {
    return { ...customerView(o), userId: String(o.userId), ownerNote: o.ownerNote, history: o.history, quoteCount: o.quoteCount, distanceKm: o.distanceKm };
}

async function ownerList({ tenant, status, page = 1 }) {
    const f = { tenantId: tenant._id };
    // the chips of the owner's list: Active = not finished, Advance paid = paid and not started, Delivered = handed over (balance paid or not), Cancelled = ended without delivery
    const GROUPS = {
        open: ['requested', 'quoted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'],
        paid: ['confirmed'],
        delivered: ['delivered', 'completed'],
        cancelled: ['cancelled', 'declined', 'expired'],
    };
    if (GROUPS[status]) f.status = { $in: GROUPS[status] };
    else if (status) f.status = status;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const rows = await BulkOrder.find(f).sort({ createdAt: -1 }).skip((p - 1) * 20).limit(21).lean();
    return { items: rows.slice(0, 20).map(ownerView), hasMore: rows.length > 20, page: p };
}

async function ownerOne({ tenant, id }) {
    if (!isId(String(id))) throw httpError(404, 'Bulk order not found');
    const o = await BulkOrder.findOne({ _id: id, tenantId: tenant._id }).lean();
    if (!o) throw httpError(404, 'Bulk order not found');
    return o;
}

// The owner sets the prices and sends the quote. body: { lines: [{ id, unitPrice }] (a line left out is dropped), discount?, deliveryFee?, packagingCharge?,
// advancePercent?, validHours?, note? }. Every total is worked out here again.
async function quote({ tenant, id, body = {} }) {
    const o = await ownerOne({ tenant, id });
    if (o.status !== 'requested') throw httpError(409, o.status === 'quoted' ? 'A quote was already sent. Wait for the customer, or for it to run out.' : 'This order can no longer be quoted');
    const s = await settingsOf(tenant._id);

    const asked = Array.isArray(body.lines) ? body.lines : [];
    if (!asked.length) throw httpError(400, 'Keep at least one dish in the quote');
    const byId = new Map(o.lines.map((l) => [String(l._id), l]));
    const seen = new Set();
    const lines = asked.map((a) => {
        const base = byId.get(String(a.id));
        if (!base || seen.has(String(a.id))) throw httpError(400, 'A dish in the quote is not part of this order');
        seen.add(String(a.id));
        const unitPrice = num(a.unitPrice, 0, 100000, `The price of "${base.name}"`);
        const rate = round2(unitPrice);
        return { ...base, unitPrice: rate, lineTotal: round2(rate * base.quantity), bulkApplied: rate < (base.listPrice ?? rate) };
    });
    const subtotal = round2(lines.reduce((n, l) => n + l.lineTotal, 0));
    const discount = body.discount === undefined ? 0 : round2(num(body.discount, 0, subtotal, 'The discount'));

    const mode = o.gstMode || 'none';
    const tax = applyTax(lines, { mode, discount, subtotal });
    const onTop = round2(lines.reduce((n, l) => n + ((mode !== 'none' && (l.gstInclusive === false || (l.gstInclusive == null && mode === 'exclusive'))) ? (l.tax || 0) : 0), 0));
    const inside = round2(tax - onTop);
    const delivery = o.fulfilment === 'delivery' ? (body.deliveryFee === undefined ? o.pricing.deliveryFee : round2(num(body.deliveryFee, 0, 50000, 'The delivery fee'))) : 0;
    const packaging = body.packagingCharge === undefined ? o.pricing.packagingCharge : round2(num(body.packagingCharge, 0, 50000, 'The packaging charge'));
    const total = round2(subtotal - discount + delivery + packaging + onTop);
    if (!(total >= 1)) throw httpError(400, 'The total must be at least ₹1');

    const advancePercent = body.advancePercent === undefined ? s.advancePercent : num(body.advancePercent, 10, 100, 'The advance');
    const validHours = body.validHours === undefined ? s.quoteValidHours : Math.round(num(body.validHours, 1, 168, 'The quote validity'));
    const totalPaise = Math.round(total * 100);
    const advancePaise = Math.max(100, Math.min(totalPaise, Math.round((totalPaise * advancePercent) / 100)));

    const quoted = {
        version: (o.quoteCount || 0) + 1, lines,
        pricing: { subtotal, discount, deliveryFee: delivery, packagingCharge: packaging, tax, taxOnTop: onTop, taxIncluded: inside, taxMode: o.pricing.taxMode, taxPercent: o.pricing.taxPercent, total },
        advancePercent, fullRefundHours: s.fullRefundHours, advancePaise, balancePaise: totalPaise - advancePaise,
        validUntil: new Date(Date.now() + validHours * 3600000), note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : undefined, quotedAt: new Date(),
    };
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: 'requested' },
        { $set: { status: 'quoted', quote: quoted, quoteCount: quoted.version }, $unset: { changeNote: 1 }, $push: { history: { status: 'quoted', by: 'owner', note: `v${quoted.version}` } } },
        { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order was just changed. Open it again.');
    tell('bulk_quoted', { tenantId: tenant._id, userId: done.userId, vars: { code: done.code, total, advance: advancePaise / 100, hours: validHours, note: clip(quoted.note) }, data: { kind: 'bulk', bulkId: String(done._id) } });
    return ownerView(done);
}

async function decline({ tenant, id, reason }) {
    const o = await ownerOne({ tenant, id });
    const text = String(reason || '').trim().slice(0, 300);
    if (!text) throw httpError(400, 'Tell the customer why');
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: { $in: OPEN } },
        { $set: { status: 'declined', declineReason: text }, $push: { history: { status: 'declined', by: 'owner', note: text } } }, { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order can no longer be declined');
    tell('bulk_declined', { tenantId: tenant._id, userId: done.userId, vars: { code: done.code, reason: text }, data: { kind: 'bulk', bulkId: String(done._id) } });
    return ownerView(done);
}

async function setOwnerNote({ tenant, id, note }) {
    const o = await ownerOne({ tenant, id });
    await BulkOrder.updateOne({ _id: o._id }, { $set: { ownerNote: String(note || '').slice(0, 1000) } });
    return { ok: true };
}

// quotes that ran out are marked (the customer already sees them as expired)
async function expireOld(now = new Date()) {
    const r = await BulkOrder.updateMany({ status: 'quoted', 'quote.validUntil': { $lt: now } }, { $set: { status: 'expired' }, $push: { history: { status: 'expired', by: 'system' } } });
    return r.modifiedCount;
}

module.exports = {
    RECOMMENDED, settingsOf, saveSettings, cleanBulkPrice, publicConfig, menuFor, priceRequest, estimate, create, customerView, mine, listMine, cancelByCustomer, previewCancel, cancelOutcome, refundDue, ownerCancel, balanceDue, setStage, markCash, tryComplete, repairCompleted, invoiceFor, askChange,
    advanceFromTicket, balanceFromTicket,
    ownerView, ownerList, ownerOne, quote, decline, setOwnerNote, expireOld, effectiveStatus,
};
