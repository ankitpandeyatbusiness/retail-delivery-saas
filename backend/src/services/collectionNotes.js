// Notes and promises about unpaid rent: "Ramesh said he will pay on Friday". Shown in Who owes you; a morning alert on the promise day.
const CollectionNote = require('../models/CollectionNote');
const Tenant = require('../models/Tenant');
const { httpError } = require('../middlewares/apiErrors');

const IST = 330 * 60000;
const DAY = 86400000;
// a "2026-11-07" or an ISO date -> the start of that India day
function dayStart(v) {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw httpError(400, 'The promise date must look like 2026-11-07');
    const d = new Date(`${s}T00:00:00+05:30`);
    if (Number.isNaN(d.getTime())) throw httpError(400, 'The promise date is not a real day');
    return d;
}
const todayStart = (now = Date.now()) => { const d = new Date(now + IST); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - IST); };

async function add({ tenantId, note, promiseDate, by }) {
    const text = String(note || '').trim();
    if (text.length < 3) throw httpError(400, 'Write a few words about what the shop said');
    if (text.length > 200) throw httpError(400, 'Keep the note under 200 characters');
    const when = dayStart(promiseDate);
    if (when && when.getTime() < todayStart().getTime()) throw httpError(400, 'The promise day cannot be in the past');
    if (when && when.getTime() > todayStart().getTime() + 120 * DAY) throw httpError(400, 'The promise day is too far away');
    if (!(await Tenant.exists({ _id: tenantId }))) throw httpError(404, 'Shop not found');
    // a new promise replaces the open one of the same shop, so the list always shows the latest word
    await CollectionNote.updateMany({ tenantId, status: 'open' }, { $set: { status: 'closed', closedAt: new Date() } });
    return CollectionNote.create({ tenantId, note: text, promiseDate: when || undefined, by: by ? String(by).slice(0, 80) : undefined });
}

// outcome: paid | broken | closed
async function close(id, outcome) {
    if (!['paid', 'broken', 'closed'].includes(outcome)) throw httpError(400, 'outcome must be paid, broken or closed');
    const n = await CollectionNote.findOneAndUpdate({ _id: id, status: 'open' }, { $set: { status: outcome, closedAt: new Date() } }, { returnDocument: 'after' });
    if (!n) throw httpError(404, 'Note not found, or already closed');
    return n;
}

const view = (n) => ({ id: String(n._id), tenantId: String(n.tenantId), note: n.note, promiseDate: n.promiseDate || null, status: n.status, by: n.by || '', at: n.createdAt });

async function listFor(tenantId) {
    const rows = await CollectionNote.find({ tenantId }).sort({ createdAt: -1 }).limit(20).lean();
    return rows.map(view);
}

// the newest open note of each shop: Map tenantId -> view
async function openFor(tenantIds) {
    if (!tenantIds.length) return new Map();
    const rows = await CollectionNote.find({ tenantId: { $in: tenantIds }, status: 'open' }).sort({ createdAt: -1 }).lean();
    const out = new Map();
    for (const n of rows) if (!out.has(String(n.tenantId))) out.set(String(n.tenantId), { ...view(n), late: !!n.promiseDate && n.promiseDate.getTime() < todayStart().getTime() });
    return out;
}

// promises whose day is today (or passed) and not yet told about: the morning alert uses this, once per note
async function dueToday(now = Date.now()) {
    const end = new Date(todayStart(now).getTime() + DAY);
    const rows = await CollectionNote.find({ status: 'open', promiseDate: { $lt: end }, remindedAt: { $exists: false } }).sort({ promiseDate: 1 }).limit(20).lean();
    return rows;
}
const markReminded = (id) => CollectionNote.updateOne({ _id: id, remindedAt: { $exists: false } }, { $set: { remindedAt: new Date() } });

module.exports = { add, close, listFor, openFor, dueToday, markReminded, view, dayStart, todayStart };
