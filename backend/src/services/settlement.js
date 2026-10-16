// The common settlement sheet between the two partners: "owner" (owns the platform) and "partner" (the operator whose company
// issues the invoices and receives the shops' money). It records NUMBERS: who owes whom how much, and what has been settled.
// The real money moves outside the app.
//
//   receipts   made by themselves when a shop pays: rent, setup fee, SMS top-up. Shared on the amount BEFORE GST by who brought
//              the shop (default: partner brought 50/50, owner brought 70/30 for the owner).
//   costs      SMS provider recharge, server, database, API, misc: always shared by costOwnerPct (50/50). One partner paid it all.
//   set-off    what one owes is set against what the other owes, with a reason.
//   claims     the partner can say "I have paid"; only the supreme admin confirms it. Nothing is deleted: every change is an event.
const mongoose = require('mongoose');
const SettlementEntry = require('../models/SettlementEntry');
const Counter = require('../models/Counter');
const Tenant = require('../models/Tenant');
const PlatformSettings = require('../models/PlatformSettings');
const { httpError } = require('../middlewares/apiErrors');

const DAY_MS = 86400000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const other = (side) => (side === 'owner' ? 'partner' : 'owner');
const COST_CATEGORIES = ['sms_recharge', 'server', 'database', 'api', 'misc'];
const DEFAULTS = { ownerName: 'Owner', partnerName: 'Partner', mode: 'split', payDays: 15, ownerPctPartnerBrought: 50, ownerPctOwnerBrought: 70, costOwnerPct: 50 };

async function getConfig() {
    const p = await PlatformSettings.findById('main').select('settlement').lean();
    return { ...DEFAULTS, ...(p?.settlement || {}) };
}

const who = (admin) => ({ id: admin ? String(admin._id) : undefined, name: admin ? (admin.name || admin.email || 'Admin') : 'System' });

async function nextNo() {
    const c = await Counter.findOneAndUpdate({ _id: 'settlement' }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
    return c.seq;
}

const statusOf = (e) => (e.dueAmount <= 0 || e.paidAmount >= e.dueAmount - 0.005 ? 'paid' : e.paidAmount > 0 ? 'partial' : 'pending');
const remaining = (e) => round2(Math.max(0, (e.dueAmount || 0) - (e.paidAmount || 0)));

// shares of one amount for a ratio
function shares(amount, ownerPct) {
    const ownerShare = round2((amount * ownerPct) / 100);
    return { ownerShare, partnerShare: round2(amount - ownerShare) };
}

/* ------------------------------- receipts ------------------------------- */
// A shop paid. Safe to call twice for the same payment (the key makes it one row).
//   category: rent | setup | topup     receivedBy: who got the money (default: the partner's account, unless mode is owner_only)
async function recordReceipt({ key, category, tenantId, invoiceId, topupId, invoiceNo, baseAmount, gstAmount = 0, totalAmount, date = new Date(), receivedBy, by }) {
    if (!(baseAmount > 0)) return null;
    const cfg = await getConfig();
    const existing = await SettlementEntry.findOne({ key });
    if (existing) {
        if (existing.voided) {   // the payment was undone and is made again
            existing.voided = false;
            existing.events.push({ action: 'restored', by: who(by), status: existing.status });
            await existing.save();
        }
        return existing;
    }
    const tenant = tenantId ? await Tenant.findById(tenantId).select('name broughtBy').lean() : null;
    const ownerOnly = cfg.mode === 'owner_only';
    const broughtBy = tenant?.broughtBy || null;
    const ownerPct = ownerOnly ? 100 : (broughtBy === 'owner' ? cfg.ownerPctOwnerBrought : cfg.ownerPctPartnerBrought);
    const got = ownerOnly ? 'owner' : (receivedBy === 'owner' ? 'owner' : 'partner');
    const s = shares(baseAmount, ownerPct);
    // the one who got the money owes the other one his share
    const owes = got === 'partner' ? 'partner' : 'owner';
    const dueAmount = got === 'partner' ? s.ownerShare : s.partnerShare;
    const no = await nextNo();
    const entry = {
        no, kind: 'receipt', category, key, date, tenantId, shopName: tenant?.name, invoiceNo, invoiceId, topupId,
        title: `${category === 'topup' ? 'SMS top-up' : category === 'setup' ? 'Setup fee' : 'Rent'}${invoiceNo ? ` ${invoiceNo}` : ''}`,
        baseAmount: round2(baseAmount), gstAmount: round2(gstAmount), totalAmount: round2(totalAmount ?? baseAmount + gstAmount),
        broughtBy, receivedBy: got, ratio: { ownerPct, partnerPct: 100 - ownerPct }, ...s,
        owes: dueAmount > 0 ? owes : null, dueAmount, paidAmount: 0,
        dueAt: new Date(new Date(date).getTime() + cfg.payDays * DAY_MS),
        events: [{ action: 'created', by: who(by), date, amount: dueAmount, status: dueAmount > 0 ? 'pending' : 'paid' }],
    };
    entry.status = statusOf(entry);
    try {
        const doc = await SettlementEntry.create(entry);
        notifyReceipt(doc, cfg).catch((e) => console.error('Settlement alert error:', e.message));
        return doc;
    } catch (e) {
        if (e.code === 11000) return SettlementEntry.findOne({ key });   // another run made it a moment ago
        throw e;
    }
}

const rs = (n) => `Rs ${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const dayOf = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
const WHAT = { rent: 'rent', setup: 'a setup fee', topup: 'an SMS top-up' };

// tells the supreme admin at once: this shop paid, so this much will come to / goes to the partner
async function notifyReceipt(doc, cfg) {
    const names = { owner: cfg.ownerName, partner: cfg.partnerName };
    const title = `${doc.shopName || 'A shop'} paid ${rs(doc.totalAmount)} for ${WHAT[doc.category] || doc.category}`;
    let body;
    if (!doc.owes) body = 'Everything is yours: nothing to settle.';
    else if (doc.owes === 'partner') body = `${names.partner} owes you ${rs(doc.dueAmount)} (${doc.ratio.ownerPct}% of ${rs(doc.baseAmount)}, before GST). Due by ${dayOf(doc.dueAt)}.`;
    else body = `You owe ${names.partner} ${rs(doc.dueAmount)} (${doc.ratio.partnerPct}% of ${rs(doc.baseAmount)}, before GST), because you received the money.`;
    if (!doc.broughtBy && cfg.mode !== 'owner_only') body += ' This shop is not marked as "brought by" yet, so the ratio used is the partner-brought one.';
    await require('./adminAlerts').alert('admin_settlement_due', { tenantId: doc.tenantId, supremeOnly: true, vars: { title, body }, data: { kind: 'settlement', entryId: String(doc._id), amount: doc.dueAmount } });
}

// a rent / setup bill that became paid (online or by hand)
async function recordInvoicePaid(inv, { receivedBy, by } = {}) {
    if (!inv || inv.status !== 'paid') return null;
    return recordReceipt({
        key: `inv:${inv._id}`, category: inv.kind === 'custom' ? 'setup' : 'rent', tenantId: inv.tenantId, invoiceId: inv._id, invoiceNo: inv.invoiceNo,
        baseAmount: inv.baseAmount, gstAmount: inv.gstAmount, totalAmount: inv.total, date: inv.paidAt || new Date(), receivedBy: receivedBy || inv.receivedBy, by,
    });
}

// a bill was set back to unpaid: its row is kept but no longer counts (unless something was already settled)
async function invoiceUnpaid(invoiceId, by) {
    const e = await SettlementEntry.findOne({ key: `inv:${invoiceId}` });
    if (!e || e.voided) return e;
    e.voided = true;
    e.events.push({ action: 'voided', by: who(by), note: 'The payment was undone', status: e.status });
    await e.save();
    return e;
}

async function recordTopupPaid(topup) {
    if (!topup || topup.status !== 'paid') return null;
    return recordReceipt({
        key: `topup:${topup._id}`, category: 'topup', tenantId: topup.tenantId, topupId: topup._id, invoiceNo: topup.invoice?.invoiceNo,
        baseAmount: topup.amountPaise / 100, gstAmount: (topup.gstPaise || 0) / 100, totalAmount: (topup.payablePaise ?? topup.amountPaise) / 100,
        date: topup.paidAt || new Date(),
    });
}

/* --------------------------- costs and adjustments --------------------------- */
async function addCost({ category, title, amount, date, paidBy, note }, admin) {
    if (!COST_CATEGORIES.includes(category)) throw httpError(400, `category must be one of: ${COST_CATEGORIES.join(', ')}`);
    if (!(Number(amount) > 0) || Number(amount) > 100000000) throw httpError(400, 'amount must be more than 0');
    if (!['owner', 'partner'].includes(paidBy)) throw httpError(400, 'paidBy must be "owner" or "partner"');
    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) throw httpError(400, 'date is not a date');
    const cfg = await getConfig();
    const s = shares(round2(amount), cfg.costOwnerPct);
    // the one who paid it all gets back the other one's share
    const owes = other(paidBy);
    const dueAmount = owes === 'owner' ? s.ownerShare : s.partnerShare;
    const no = await nextNo();
    const entry = {
        no, kind: 'cost', category, title: String(title || '').trim().slice(0, 120) || category.replace('_', ' '), date: when, amount: round2(amount), paidBy,
        ratio: { ownerPct: cfg.costOwnerPct, partnerPct: 100 - cfg.costOwnerPct }, ...s, owes, dueAmount, paidAmount: 0,
        dueAt: new Date(when.getTime() + cfg.payDays * DAY_MS), note: String(note || '').slice(0, 300) || undefined,
        events: [{ action: 'created', by: who(admin), date: when, amount: dueAmount, status: 'pending' }],
    };
    entry.status = statusOf(entry);
    return SettlementEntry.create(entry);
}

// a correction: "owes" pays "amount" to the other. Written by the supreme admin, with a reason.
async function addAdjustment({ owes, amount, reason, date }, admin) {
    if (!['owner', 'partner'].includes(owes)) throw httpError(400, 'owes must be "owner" or "partner"');
    if (!(Number(amount) > 0)) throw httpError(400, 'amount must be more than 0');
    const text = String(reason || '').trim();
    if (!text) throw httpError(400, 'Write the reason');
    const cfg = await getConfig();
    const when = date ? new Date(date) : new Date();
    const no = await nextNo();
    const entry = {
        no, kind: 'adjustment', category: 'adjustment', title: text.slice(0, 120), date: when, amount: round2(amount), owes, dueAmount: round2(amount), paidAmount: 0,
        dueAt: new Date(when.getTime() + cfg.payDays * DAY_MS), note: text.slice(0, 300),
        events: [{ action: 'created', by: who(admin), date: when, amount: round2(amount), note: text, status: 'pending' }],
    };
    entry.status = statusOf(entry);
    return SettlementEntry.create(entry);
}

/* ------------------------------ paying, claims, set-off ------------------------------ */
async function load(id) {
    if (!mongoose.isValidObjectId(id)) throw httpError(404, 'Row not found');
    const e = await SettlementEntry.findById(id);
    if (!e) throw httpError(404, 'Row not found');
    return e;
}

function applyPayment(e, { amount, date, ref, note }, admin, action = 'paid', extra = {}) {
    const amt = round2(amount);
    if (!(amt > 0)) throw httpError(400, 'amount must be more than 0');
    if (amt > remaining(e) + 0.005) throw httpError(400, `Only ${remaining(e).toFixed(2)} is left to pay on this row`);
    e.paidAmount = round2(e.paidAmount + amt);
    e.status = statusOf(e);
    e.events.push({ action, by: who(admin), amount: amt, date: date ? new Date(date) : new Date(), ref: ref ? String(ref).slice(0, 60) : undefined, note: note ? String(note).slice(0, 300) : undefined, status: e.status, ...extra });
}

// the supreme admin records money that moved
async function markPaid(id, body, admin) {
    const e = await load(id);
    if (e.voided) throw httpError(409, 'This row is cancelled (the payment was undone)');
    if (!e.owes) throw httpError(409, 'Nothing is due on this row');
    if (body.date && Number.isNaN(new Date(body.date).getTime())) throw httpError(400, 'date is not a date');
    applyPayment(e, { amount: body.amount ?? remaining(e), date: body.date, ref: body.ref, note: body.note }, admin);
    if (e.claim?.state === 'open') e.claim.state = 'confirmed';
    await e.save();
    return e;
}

// anybody with a superadmin login (the partner) can say "I have paid"; it is only a note until the supreme admin confirms it
async function claim(id, body, admin) {
    const e = await load(id);
    if (e.voided || !e.owes) throw httpError(409, 'Nothing is due on this row');
    const amt = round2(body.amount ?? remaining(e));
    if (!(amt > 0) || amt > remaining(e) + 0.005) throw httpError(400, `Only ${remaining(e).toFixed(2)} is left to pay on this row`);
    e.claim = { amount: amt, date: body.date ? new Date(body.date) : new Date(), ref: body.ref ? String(body.ref).slice(0, 60) : undefined, note: body.note ? String(body.note).slice(0, 300) : undefined, at: new Date(), by: who(admin), state: 'open' };
    e.events.push({ action: 'claim', by: who(admin), amount: amt, date: e.claim.date, ref: e.claim.ref, note: e.claim.note, status: e.status });
    await e.save();
    return e;
}

async function confirmClaim(id, admin) {
    const e = await load(id);
    if (e.claim?.state !== 'open') throw httpError(409, 'There is no open "I have paid" note on this row');
    const c = e.claim;
    applyPayment(e, { amount: c.amount, date: c.date, ref: c.ref, note: c.note }, admin, 'claim_confirmed');
    e.claim.state = 'confirmed';
    await e.save();
    return e;
}

async function rejectClaim(id, note, admin) {
    const e = await load(id);
    if (e.claim?.state !== 'open') throw httpError(409, 'There is no open "I have paid" note on this row');
    e.claim.state = 'rejected';
    e.events.push({ action: 'claim_rejected', by: who(admin), note: note ? String(note).slice(0, 300) : undefined, status: e.status });
    await e.save();
    return e;
}

// Set what the partner owes the owner against what the owner owes the partner. Needs a reason typed by hand.
async function setOff({ fromPartnerId, fromOwnerId, amount, reason }, admin) {
    const text = String(reason || '').trim();
    if (!text) throw httpError(400, 'Write the reason for the set-off');
    const a = await load(fromPartnerId);   // a row where the partner owes the owner
    const b = await load(fromOwnerId);     // a row where the owner owes the partner
    if (a.owes !== 'partner') throw httpError(400, 'The first row must be one where the partner has to pay');
    if (b.owes !== 'owner') throw httpError(400, 'The second row must be one where the owner has to pay');
    if (a.voided || b.voided) throw httpError(409, 'A cancelled row cannot be set off');
    const max = Math.min(remaining(a), remaining(b));
    const amt = round2(amount ?? max);
    if (!(amt > 0)) throw httpError(400, 'amount must be more than 0');
    if (amt > max + 0.005) throw httpError(400, `At most ${max.toFixed(2)} can be set off between these two rows`);
    const setoffId = new mongoose.Types.ObjectId().toString();
    applyPayment(a, { amount: amt, note: text }, admin, 'setoff', { setoffId, ref: `against #${b.no}` });
    applyPayment(b, { amount: amt, note: text }, admin, 'setoff', { setoffId, ref: `against #${a.no}` });
    await Promise.all([a.save(), b.save()]);
    return { amount: amt, setoffId, partnerRow: a, ownerRow: b };
}

// who brought the shop: changes the shares of rows that nothing has been paid on yet
async function setBroughtBy(tenantId, broughtBy, admin) {
    if (!['owner', 'partner'].includes(broughtBy)) throw httpError(400, 'broughtBy must be "owner" or "partner"');
    const t = await Tenant.findByIdAndUpdate(tenantId, { $set: { broughtBy, broughtBySetAt: new Date() } }, { returnDocument: 'after' }).select('name broughtBy').lean();
    if (!t) throw httpError(404, 'Shop not found');
    const cfg = await getConfig();
    const rows = await SettlementEntry.find({ tenantId, kind: 'receipt' });
    let changed = 0; let locked = 0;
    for (const e of rows) {
        if (e.broughtBy === broughtBy) continue;
        if (e.paidAmount > 0 || e.claim?.state === 'open') { locked += 1; continue; }   // settled rows are never rewritten
        const ownerPct = cfg.mode === 'owner_only' ? 100 : (broughtBy === 'owner' ? cfg.ownerPctOwnerBrought : cfg.ownerPctPartnerBrought);
        Object.assign(e, { broughtBy, ratio: { ownerPct, partnerPct: 100 - ownerPct }, ...shares(e.baseAmount, ownerPct) });
        e.dueAmount = e.receivedBy === 'partner' ? e.ownerShare : e.partnerShare;
        e.owes = e.dueAmount > 0 ? e.receivedBy : null;
        e.status = statusOf(e);
        e.events.push({ action: 'brought_by', by: who(admin), note: `Shop marked as brought by the ${broughtBy}`, amount: e.dueAmount, status: e.status });
        await e.save();
        changed += 1;
    }
    return { shop: t.name, broughtBy, rowsChanged: changed, rowsLocked: locked };
}

/* ------------------------------ reading the sheet ------------------------------ */
function monthRange(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw httpError(400, 'month must look like 2026-10');
    const from = new Date(`${month}-01T00:00:00+05:30`);
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return { $gte: from, $lt: new Date(`${next}-01T00:00:00+05:30`) };
}

function filterOf(q = {}) {
    const f = { voided: { $ne: true } };
    if (q.kind) f.kind = q.kind;
    if (q.month) f.date = monthRange(q.month);
    if (mongoose.isValidObjectId(q.tenantId)) f.tenantId = new mongoose.Types.ObjectId(q.tenantId);
    if (q.status === 'open') f.status = { $in: ['pending', 'partial'] };
    else if (['pending', 'partial', 'paid'].includes(q.status)) f.status = q.status;
    if (q.status === 'late') { f.status = { $in: ['pending', 'partial'] }; f.dueAt = { $lt: new Date() }; }
    return f;
}

async function list(q = {}, { page = 1, limit = 30 } = {}) {
    const rows = await SettlementEntry.find(filterOf(q)).sort({ date: -1, no: -1 }).skip((page - 1) * limit).limit(limit + 1).select('-events').lean();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const now = Date.now();
    return { items: rows.map((r) => ({ ...r, remaining: remaining(r), late: r.status !== 'paid' && r.dueAt && new Date(r.dueAt).getTime() < now })), page, hasMore };
}

async function summary(q = {}) {
    const cfg = await getConfig();
    const rows = await SettlementEntry.find(filterOf({ ...q, status: undefined })).select('kind category owes dueAmount paidAmount status dueAt baseAmount').lean();
    const now = Date.now();
    const sum = { partnerOwesOwner: 0, ownerOwesPartner: 0, lateAmount: 0, lateRows: 0, openRows: 0, receivedBase: 0, claims: 0 };
    for (const r of rows) {
        if (r.kind === 'receipt') sum.receivedBase += r.baseAmount || 0;
        if (r.status === 'paid' || !r.owes) continue;
        const left = remaining(r);
        sum.openRows += 1;
        if (r.owes === 'partner') sum.partnerOwesOwner += left; else sum.ownerOwesPartner += left;
        if (r.dueAt && new Date(r.dueAt).getTime() < now) { sum.lateAmount += left; sum.lateRows += 1; }
    }
    sum.claims = await SettlementEntry.countDocuments({ 'claim.state': 'open', voided: { $ne: true } });
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]));
    const net = round2(sum.partnerOwesOwner - sum.ownerOwesPartner);
    return { config: cfg, ...round(sum), netPartnerPaysOwner: net, netOwnerPaysPartner: net < 0 ? -net : 0, netOwed: net > 0 ? { from: 'partner', to: 'owner', amount: net } : net < 0 ? { from: 'owner', to: 'partner', amount: -net } : null };
}

async function one(id) {
    const e = await load(id);
    const o = e.toObject();
    return { ...o, remaining: remaining(o), late: o.status !== 'paid' && o.dueAt && new Date(o.dueAt).getTime() < Date.now() };
}

async function saveConfig(body = {}) {
    const set = {};
    for (const k of ['ownerName', 'partnerName']) {
        if (body[k] === undefined) continue;
        const v = String(body[k]).trim();
        if (!v || v.length > 40) throw httpError(400, `${k} is needed (up to 40 letters)`);
        set[`settlement.${k}`] = v;
    }
    for (const [k, lo, hi] of [['payDays', 0, 90], ['ownerPctPartnerBrought', 0, 100], ['ownerPctOwnerBrought', 0, 100], ['costOwnerPct', 0, 100]]) {
        if (body[k] === undefined) continue;
        if (!Number.isInteger(body[k]) || body[k] < lo || body[k] > hi) throw httpError(400, `${k} must be a whole number from ${lo} to ${hi}`);
        set[`settlement.${k}`] = body[k];
    }
    if (body.mode !== undefined) {
        if (!['split', 'owner_only'].includes(body.mode)) throw httpError(400, 'mode must be "split" or "owner_only"');
        set['settlement.mode'] = body.mode;
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    await PlatformSettings.findByIdAndUpdate('main', { $set: set }, { upsert: true });
    return getConfig();
}

module.exports = {
    COST_CATEGORIES, DEFAULTS, getConfig, saveConfig, recordReceipt, recordInvoicePaid, invoiceUnpaid, recordTopupPaid,
    addCost, addAdjustment, markPaid, claim, confirmClaim, rejectClaim, setOff, setBroughtBy, list, summary, one, filterOf, remaining,
};
