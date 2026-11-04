// Mark an item of a Needs attention list as handled by hand, and take it back within 10 minutes.
// Money tab and Orders tab share this. Nothing about the thing itself changes: the item only leaves the list.
const mongoose = require('mongoose');
const HandledMark = require('../models/HandledMark');
const { httpError } = require('../middlewares/apiErrors');

const UNDO_MS = 10 * 60000;
const MONEY = ['overdue', 'to_close', 'refund_failed', 'webhook_failed', 'unmatched', 'topup_uncredited', 'paid_no_date', 'sms_low'];
const ORDERS = ['order_problem'];
const scopeOf = (kind) => (MONEY.includes(kind) ? 'money' : ORDERS.includes(kind) ? 'orders' : null);

async function mark({ kind, refId, note, title, by }) {
    const scope = scopeOf(kind);
    if (!scope) throw httpError(400, 'Unknown list');
    const id = String(refId || '').trim();
    if (!id || id.length > 80) throw httpError(400, 'Which item?');
    const text = String(note || '').trim().slice(0, 200);
    const open = await HandledMark.findOne({ kind, refId: id, undoneAt: { $exists: false } });
    if (open) return open;   // already marked: tapping twice does nothing more
    return HandledMark.create({ scope, kind, refId: id, note: text, title: String(title || '').slice(0, 120), by: by ? String(by).slice(0, 80) : '' });
}

async function undo({ id, by, now = Date.now() }) {
    const m = mongoose.isValidObjectId(id) ? await HandledMark.findById(id) : null;
    if (!m) throw httpError(404, 'Not found');
    if (m.undoneAt) throw httpError(409, 'Already taken back');
    if (now - new Date(m.createdAt).getTime() > UNDO_MS) throw httpError(409, 'Taking it back is only possible in the first 10 minutes');
    m.undoneAt = new Date(now);
    m.undoneBy = by ? String(by).slice(0, 80) : '';
    await m.save();
    return m;
}

// the ids of the open marks of one list (strings)
async function activeIds(kind) {
    return (await HandledMark.find({ kind, undoneAt: { $exists: false } }).select('refId').lean()).map((m) => m.refId);
}
const objectIds = (ids) => ids.filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(x));

const view = (m, now = Date.now()) => {
    const left = UNDO_MS - (now - new Date(m.createdAt).getTime());
    return { id: String(m._id), kind: m.kind, refId: m.refId, title: m.title || '', note: m.note || '', by: m.by || '', at: m.createdAt, undoLeftSec: !m.undoneAt && left > 0 ? Math.ceil(left / 1000) : 0 };
};

// the open marks of a scope or one list, newest first
async function list({ scope, kind, limit = 100, now = Date.now() }) {
    const rows = await HandledMark.find({ ...(scope ? { scope } : {}), ...(kind ? { kind } : {}), undoneAt: { $exists: false } }).sort({ createdAt: -1 }).limit(limit).lean();
    return rows.map((m) => view(m, now));
}
// a map refId -> view of the open mark, for one list
async function mapFor(kind, now = Date.now()) {
    const rows = await HandledMark.find({ kind, undoneAt: { $exists: false } }).lean();
    return new Map(rows.map((m) => [m.refId, view(m, now)]));
}

module.exports = { mark, undo, activeIds, objectIds, list, mapFor, view, scopeOf, UNDO_MS, MONEY, ORDERS };
