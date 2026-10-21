// A cook's or a waiter's leave: they ask, the owner says yes or no (with a note), they are told. Approved leave goes into their calendar as days off, so
// alerts skip those days. Like a rider's leave, but one list per shop. (Plain holidays are self-declared: services/staffDuty.js.)
const Staff = require('../models/Staff');
const StaffLeave = require('../models/StaffLeave');
const { httpError } = require('../middlewares/apiErrors');

const MAX_DAYS = 31;
const IST_MS = 330 * 60000;
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const today = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));

const shape = (l) => ({
    id: String(l._id), userId: String(l.userId), name: l.name || '', role: l.role, from: l.from, to: l.to, days: l.days, reason: l.reason || '',
    status: l.status, note: l.decidedNote || '', at: l.createdAt,
});

// the person's own list (newest first)
async function mine(tenantId, userId) {
    const rows = await StaffLeave.find({ tenantId, userId }).sort({ createdAt: -1 }).limit(15).lean();
    return rows.map(shape);
}

async function request({ tenantId, staff, from, to, reason, now = new Date() }) {
    if (!validDate(from) || !validDate(to)) throw httpError(400, 'Choose the first and the last day of your leave');
    if (to < from) throw httpError(400, 'The last day cannot be before the first day');
    if (from < today(now)) throw httpError(400, 'Leave cannot start in the past');
    const days = daysBetween(from, to);
    if (days > MAX_DAYS) throw httpError(400, `Leave can be at most ${MAX_DAYS} days at a time`);
    const why = String(reason || '').trim().slice(0, 200);
    if (!why) throw httpError(400, 'Please write the reason for your leave');
    const clash = await StaffLeave.findOne({ tenantId, userId: staff.id, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } }).select('from to status').lean();
    if (clash) throw httpError(409, `You already have leave from ${clash.from} to ${clash.to} (${clash.status})`);
    const l = await StaffLeave.create({ tenantId, userId: staff.id, name: staff.name, role: staff.role, from, to, days, reason: why });
    tell('staff_leave_request', {
        tenantId, vars: { name: staff.name || 'Your staff', job: staff.role === 'kitchen' ? 'Kitchen' : 'Waiter', from, to, days, reason: why },
        data: { kind: 'staff_leave', leaveId: String(l._id), userId: String(staff.id) },
    });
    return l;
}

async function cancel({ tenantId, userId, id }) {
    const l = await StaffLeave.findOneAndUpdate({ _id: id, tenantId, userId, status: 'pending' }, { $set: { status: 'cancelled' } }, { new: true });
    if (!l) throw httpError(404, 'Only a leave that is still waiting can be cancelled');
    return l;
}

// the owner's list: waiting first, then the latest decided
async function forOwner(tenantId) {
    const [pending, recent] = await Promise.all([
        StaffLeave.find({ tenantId, status: 'pending' }).sort({ from: 1 }).limit(50).lean(),
        StaffLeave.find({ tenantId, status: { $in: ['approved', 'rejected'] }, to: { $gte: today() } }).sort({ decidedAt: -1 }).limit(20).lean(),
    ]);
    return { pending: pending.map(shape), recent: recent.map(shape) };
}

async function decide({ tenantId, id, approve, note }) {
    if (typeof approve !== 'boolean') throw httpError(400, 'Send approve: true or false');
    const l = await StaffLeave.findOneAndUpdate(
        { _id: id, tenantId, status: 'pending' },
        { $set: { status: approve ? 'approved' : 'rejected', decidedAt: new Date(), decidedNote: String(note || '').trim().slice(0, 200) } },
        { new: true },
    );
    if (!l) throw httpError(409, 'This leave was already decided or cancelled');
    // approved: the days go into the person's calendar, so no alert reaches them (the same mechanism as a holiday)
    if (approve) await Staff.updateOne({ tenantId, userId: l.userId }, { $push: { holidays: { from: l.from, to: l.to, note: 'Leave', leaveId: l._id } } });
    tell('staff_leave_decision', {
        tenantId, userId: l.userId, vars: { approved: approve, from: l.from, to: l.to, days: l.days, note: l.decidedNote },
        data: { kind: 'staff_leave', leaveId: String(l._id) },
    });
    return shape(l);
}

module.exports = { mine, request, cancel, forOwner, decide, shape };
