// Bulk orders (step 1: request and quote; the advance and balance payments come next).
// The customer picks dishes and quantities from the whole menu; the owner sends a quote; the customer accepts (next step).
//  - every price is worked out HERE, from the menu; the app only sends what was picked
//  - a dish with a bulk price (Product.bulk: minQty + percentOff) gets it when the pieces of that dish, all options together, reach minQty
//  - the minimum order amount, the notice time and the bulk delivery fee are the shop's bulk settings (BulkSettings)
const crypto = require('crypto');
const mongoose = require('mongoose');
const BulkSettings = require('../models/BulkSettings');
const BulkOrder = require('../models/BulkOrder');
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
const OPEN = ['requested', 'quoted'];   // the customer can still cancel
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const rupees = (n) => `₹${+Number(n || 0).toFixed(2)}`;

/* ------------------------------ settings ------------------------------ */
const DEFAULTS = { enabled: false, minOrderAmount: 0, noticeHours: 48, maxQtyPerDish: 500, pickup: true, delivery: true, deliveryFee: { type: 'free' }, packagingCharge: 0, advancePercent: 50, quoteValidHours: 24, fullRefundHours: 48 };

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
    enabled: s.enabled, minOrderAmount: s.minOrderAmount, noticeHours: s.noticeHours, maxQtyPerDish: s.maxQtyPerDish,
    pickup: s.pickup, delivery: s.delivery, deliveryFee: s.deliveryFee, packagingCharge: s.packagingCharge,
    advancePercent: s.advancePercent, quoteValidHours: s.quoteValidHours, fullRefundHours: s.fullRefundHours,
});

async function needSettings(tenant) {
    const s = await settingsOf(tenant._id);
    if (!s.enabled) throw httpError(404, 'Bulk orders are not available at this shop');
    return s;
}

/* ------------------------------ the menu for the bulk screen ------------------------------ */
// The whole menu with every option and the bulk price of each dish. Dishes sold by weight are not here: bulk counts pieces.
async function menuFor(tenant) {
    const config = resolveConfig(tenant);
    const cats = await Category.find({ tenantId: tenant._id, isActive: true }).sort({ sortOrder: 1, _id: 1 }).select('name').lean();
    const products = await Product.find({
        tenantId: tenant._id, isActive: true, isAvailable: { $ne: false }, sellBy: { $in: ['piece', null] }, categoryId: { $in: cats.map((c) => c._id) },
        ...foodModeFilter(config.home.foodMode),
    }).sort({ sortOrder: 1, _id: 1 }).select('categoryId name description image isVeg price optionGroups bulk serves').lean();
    return {
        categories: cats.map((c) => ({
            id: String(c._id), name: c.name,
            items: products.filter((p) => String(p.categoryId) === String(c._id)).map((p) => ({
                id: String(p._id), name: p.name, description: p.description, image: p.image, isVeg: p.isVeg, price: p.price, serves: p.serves,
                optionGroups: p.optionGroups || [], bulk: p.bulk?.minQty ? { minQty: p.bulk.minQty, percentOff: p.bulk.percentOff } : null,
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
    const prods = await Product.find({ _id: { $in: lines.map((l) => l.productId) } }).select('bulk').lean();
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

const lineView = (l) => ({
    id: l._id ? String(l._id) : undefined, productId: String(l.productId), name: l.name, image: l.image, isVeg: l.isVeg, quantity: l.quantity,
    listPrice: l.listPrice, unitPrice: l.unitPrice, bulkApplied: !!l.bulkApplied, lineTotal: l.lineTotal, tax: l.tax,
    options: (l.selections || []).map((x) => x.optionName || x.name).filter(Boolean),
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
        id: String(o._id), code: o.code, status, fulfilment: o.fulfilment, when: o.when, address: o.address, contact: o.contact, cutlery: o.cutlery, packaging: o.packaging, note: o.note,
        lines: (o.lines || []).map(lineView), pricing: o.pricing, changeNote: o.changeNote, declineReason: o.declineReason,
        quote: o.quote?.pricing ? {
            version: o.quote.version, lines: (o.quote.lines || []).map(lineView), pricing: o.quote.pricing, advancePercent: o.quote.advancePercent,
            advancePaise: o.quote.advancePaise, balancePaise: o.quote.balancePaise, validUntil: o.quote.validUntil, note: o.quote.note, quotedAt: o.quote.quotedAt,
        } : null,
        createdAt: o.createdAt, updatedAt: o.updatedAt,
    };
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

// the customer cancels before anything is paid
async function cancelByCustomer({ tenant, userId, id }) {
    const o = await mine({ tenant, userId, id });
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: { $in: OPEN } },
        { $set: { status: 'cancelled' }, $push: { history: { status: 'cancelled', by: 'customer' } } }, { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order can no longer be cancelled here');
    return customerView(done);
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
    tell('bulk_change', { tenantId: tenant._id, vars: { name: done.contact?.name, code: done.code }, data: { kind: 'bulk', bulkId: String(done._id) } });
    return customerView(done);
}

/* ------------------------------ the owner ------------------------------ */
function ownerView(o) {
    return { ...customerView(o), userId: String(o.userId), ownerNote: o.ownerNote, history: o.history, quoteCount: o.quoteCount, distanceKm: o.distanceKm };
}

async function ownerList({ tenant, status, page = 1 }) {
    const f = { tenantId: tenant._id };
    if (status === 'open') f.status = { $in: ['requested', 'quoted', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'] };
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
        advancePercent, advancePaise, balancePaise: totalPaise - advancePaise,
        validUntil: new Date(Date.now() + validHours * 3600000), note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : undefined, quotedAt: new Date(),
    };
    const done = await BulkOrder.findOneAndUpdate(
        { _id: o._id, status: 'requested' },
        { $set: { status: 'quoted', quote: quoted, quoteCount: quoted.version }, $unset: { changeNote: 1 }, $push: { history: { status: 'quoted', by: 'owner', note: `v${quoted.version}` } } },
        { returnDocument: 'after' },
    ).lean();
    if (!done) throw httpError(409, 'This order was just changed. Open it again.');
    tell('bulk_quoted', { tenantId: tenant._id, userId: done.userId, vars: { code: done.code, total, advance: advancePaise / 100, hours: validHours }, data: { kind: 'bulk', bulkId: String(done._id) } });
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
    settingsOf, saveSettings, publicConfig, menuFor, priceRequest, estimate, create, customerView, mine, listMine, cancelByCustomer, askChange,
    ownerView, ownerList, ownerOne, quote, decline, setOwnerNote, expireOld, effectiveStatus,
};
