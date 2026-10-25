// A rider's duty timing, his holidays and his leave.
//
//   Rider.duty = { mode: 'manual' | 'auto', weekly: { mon: { on, from, to }, ... }, lastAutoOn, autoSession }
//     manual  he starts and ends duty himself (the default, what the app always did)
//     auto    he is put ON duty by himself when his time for the day starts, and OFF when it ends (when he has no order)
//   Rider.holidays = [{ from, to, note }]   days off he added himself (India dates, both ends included)
//   RiderLeave                              leave he asks for; the owner approves or rejects. Approved leave counts per month.
// Nothing here ever puts a rider off while he has an order. A rider who starts duty by hand outside his time in "auto" mode is left alone:
// only a session that the schedule started is ended by the schedule (Rider.duty.autoSession).
const Rider = require('../models/Rider');
const RiderLeave = require('../models/RiderLeave');
const Tenant = require('../models/Tenant');
const center = require('../notifications/center');
const { resolveConfig, openStatus } = require('./tenantConfigService');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const IST_MS = 330 * 60000;
const MAX_LEAVE_DAYS = 31;
const MAX_HOLIDAYS = 20;

const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
// a notification problem must never break the schedule or a leave request
const tell = (event, ctx) => Promise.resolve().then(() => center.notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const fail = (status, message) => Object.assign(new Error(message), { status });

function istNow(now = new Date()) {
    const ist = new Date(now.getTime() + IST_MS);
    return { date: ist.toISOString().slice(0, 10), mins: ist.getUTCHours() * 60 + ist.getUTCMinutes(), dow: ist.getUTCDay() };
}
// the real moment of "HH:MM" on an India date
const at = (ymd, hhmm) => new Date(Date.parse(`${ymd}T00:00:00Z`) + toMin(hhmm) * 60000 - IST_MS);

/* ------------------------------ his timing ------------------------------ */
const DEFAULT_DAY = { on: false, from: '09:00', to: '21:00' };
function weeklyOf(rider) {
    const w = rider?.duty?.weekly || {};
    return Object.fromEntries(DAYS.map((d) => [d, { ...DEFAULT_DAY, ...(w[d] || {}) }]));
}

function cleanDuty(body) {
    const b = body || {};
    const out = {};
    if (b.mode !== undefined) {
        if (!['manual', 'auto'].includes(b.mode)) throw fail(400, 'mode must be manual or auto');
        out.mode = b.mode;
    }
    if (b.weekly !== undefined) {
        if (!b.weekly || typeof b.weekly !== 'object') throw fail(400, 'weekly must be an object');
        out.weekly = {};
        for (const d of DAYS) {
            const v = b.weekly[d];
            if (v === undefined) continue;
            if (typeof v.on !== 'boolean') throw fail(400, `${d}: send on true or false`);
            if (!validTime(v.from) || !validTime(v.to)) throw fail(400, `${d}: times must look like 09:00`);
            if (v.from === v.to) throw fail(400, `${d}: the start and the end time must differ`);
            out.weekly[d] = { on: v.on, from: v.from, to: v.to };
        }
    }
    return out;
}

/* ------------------------------ leave and holidays ------------------------------ */
const covers = (r, date) => r.from <= date && date <= r.to;

// 'leave' | 'holiday' | null for an India date
function blockedOn(date, approvedLeaves, holidays) {
    if ((approvedLeaves || []).some((l) => covers(l, date))) return 'leave';
    if ((holidays || []).some((h) => covers(h, date))) return 'holiday';
    return null;
}

// the days of approved leaves inside the India month of `now`
function monthDays(leaves, now = new Date()) {
    const { date } = istNow(now);
    const first = `${date.slice(0, 8)}01`;
    const next = new Date(Date.parse(`${first}T00:00:00Z`));
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = addDays(next.toISOString().slice(0, 10), -1);
    let n = 0;
    for (const l of leaves) {
        const a = l.from > first ? l.from : first;
        const b = l.to < last ? l.to : last;
        if (a <= b) n += daysBetween(a, b);
    }
    return n;
}

// for the screens: per rider { pending, monthDays, monthRequests, onLeaveToday }
async function summaries(tenantId, userIds, now = new Date()) {
    const { date } = istNow(now);
    const monthStart = `${date.slice(0, 8)}01`;
    const rows = await RiderLeave.find({ tenantId, riderUserId: { $in: userIds }, status: { $in: ['pending', 'approved'] }, to: { $gte: monthStart } })
        .select('riderUserId status from to').lean();
    const out = new Map();
    for (const id of userIds) out.set(String(id), { pending: 0, monthDays: 0, monthRequests: 0, onLeaveToday: false });
    const approved = new Map();
    for (const l of rows) {
        const k = String(l.riderUserId);
        const s = out.get(k);
        if (!s) continue;
        if (l.status === 'pending') s.pending += 1;
        else {
            if (!approved.has(k)) approved.set(k, []);
            approved.get(k).push(l);
            s.monthRequests += 1;
            if (covers(l, date)) s.onLeaveToday = true;
        }
    }
    for (const [k, ls] of approved) out.get(k).monthDays = monthDays(ls, now);
    return out;
}

async function requestLeave({ tenantId, userId, from, to, reason, now = new Date() }) {
    if (!validDate(from) || !validDate(to)) throw fail(400, 'Choose the first and the last day of your leave');
    if (to < from) throw fail(400, 'The last day cannot be before the first day');
    const { date } = istNow(now);
    if (from < date) throw fail(400, 'Leave cannot start in the past');
    const days = daysBetween(from, to);
    if (days > MAX_LEAVE_DAYS) throw fail(400, `Leave can be at most ${MAX_LEAVE_DAYS} days at a time`);
    const why = String(reason || '').trim().slice(0, 200);
    if (!why) throw fail(400, 'Please write the reason for your leave');
    const clash = await RiderLeave.findOne({ tenantId, riderUserId: userId, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } }).select('from to status').lean();
    if (clash) throw fail(409, `You already have leave from ${clash.from} to ${clash.to} (${clash.status})`);
    const rider = await Rider.findOne({ tenantId, userId }).select('name').lean();
    const leave = await RiderLeave.create({ tenantId, riderUserId: userId, riderName: rider?.name || null, from, to, days, reason: why });
    tell('rider_leave_request', {
        tenantId, vars: { riderName: rider?.name || 'A delivery partner', from, to, days, reason: why },
        data: { kind: 'rider_leave', leaveId: String(leave._id), riderId: String(userId) },
    });
    return leave;
}

// he takes his leave back: one that is waiting, or an approved one that has not ended. The owner is told.
async function cancelLeave({ tenantId, userId, id }) {
    const { date } = istNow();
    const was = await RiderLeave.findOne({ _id: id, tenantId, riderUserId: userId }).select('status').lean();
    const l = await RiderLeave.findOneAndUpdate({ _id: id, tenantId, riderUserId: userId, status: { $in: ['pending', 'approved'] }, to: { $gte: date } }, { $set: { status: 'cancelled', decidedNote: 'Taken back by the delivery partner' } }, { new: true });
    if (!l) throw fail(404, 'Only a leave that is waiting, or has not ended yet, can be cancelled');
    tell('rider_leave_withdrawn', { tenantId, vars: { riderName: l.riderName || 'A delivery partner', from: l.from, to: l.to, days: l.days, wasApproved: was?.status === 'approved' }, data: { kind: 'rider_leave', leaveId: String(l._id), riderId: String(userId) } });
    return l;
}

// the owner takes a leave away (it was a mistake, or the rider is needed): the rider is told, and his screen changes at once
async function ownerRemove({ tenantId, id, note }) {
    const l = await RiderLeave.findOneAndUpdate({ _id: id, tenantId, status: { $in: ['pending', 'approved'] } }, { $set: { status: 'cancelled', decidedAt: new Date(), decidedNote: String(note || 'Removed by the owner').trim().slice(0, 200) } }, { new: true });
    if (!l) throw fail(404, 'Only a waiting or approved leave can be taken away');
    tell('rider_leave_removed', { tenantId, userId: l.riderUserId, vars: { from: l.from, to: l.to, days: l.days, note: String(note || '').trim().slice(0, 200) }, data: { kind: 'rider_leave', leaveId: String(l._id) } });
    return l;
}

async function decide({ tenantId, id, approve, note }) {
    const l = await RiderLeave.findOneAndUpdate(
        { _id: id, tenantId, status: 'pending' },
        { $set: { status: approve ? 'approved' : 'rejected', decidedAt: new Date(), decidedNote: String(note || '').trim().slice(0, 200) } },
        { new: true },
    );
    if (!l) throw fail(409, 'This leave was already decided or cancelled');
    tell('rider_leave_decision', {
        tenantId, userId: l.riderUserId, vars: { approved: !!approve, from: l.from, to: l.to, days: l.days, note: l.decidedNote },
        data: { kind: 'rider_leave', leaveId: String(l._id) },
    });
    if (approve) await endIfOnLeave(tenantId, l.riderUserId);
    return l;
}

// leave starts today: a rider who is on duty and has no order goes off duty
async function endIfOnLeave(tenantId, userId, now = new Date()) {
    const { date } = istNow(now);
    const l = await RiderLeave.exists({ tenantId, riderUserId: userId, status: 'approved', from: { $lte: date }, to: { $gte: date } });
    if (!l) return;
    await Rider.updateOne({ tenantId, userId, isOnline: true, activeOrderCount: 0 }, { $set: { isOnline: false, 'duty.autoSession': false }, $unset: { onlineSince: 1 } });
}

/* ------------------------------ the clock ------------------------------ */
// is `now` inside the rider's time for the day? { inWindow, startAt, endAt }
function windowNow(rider, now = new Date()) {
    const weekly = weeklyOf(rider);
    const { date, mins, dow } = istNow(now);
    const today = weekly[DAYS[dow]];
    if (today.on) {
        const f = toMin(today.from);
        const t = toMin(today.to);
        if (t > f ? mins >= f && mins < t : mins >= f) {
            return { inWindow: true, date, startAt: at(date, today.from) };
        }
    }
    const yDate = addDays(date, -1);
    const y = weekly[DAYS[(dow + 6) % 7]];
    if (y.on && toMin(y.to) <= toMin(y.from) && mins < toMin(y.to)) return { inWindow: true, date: yDate, startAt: at(yDate, y.from) };   // last night's shift still running
    return { inWindow: false, date, startAt: null };
}

// when a rider goes off duty by hand for a while: the time he comes back (pauseMinutes, or untilMorning = 6 am India time), or null for "until I start again"
function resumeTime(body) {
    const min = Number(body?.pauseMinutes);
    if (Number.isFinite(min) && min > 0 && min <= 720) return new Date(Date.now() + Math.round(min) * 60000);
    if (body?.untilMorning === true) {
        const ist = new Date(Date.now() + 330 * 60000);
        return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (ist.getUTCHours() >= 6 ? 1 : 0), 6, 0, 0) - 330 * 60000);
    }
    return null;
}

// riders who went off duty "for a while": back on duty when the time is up
async function resumeTimed(now = new Date()) {
    const due = await Rider.find({ isActive: true, isOnline: false, 'duty.resumeAt': { $lte: now } }).select('tenantId userId').lean();
    for (const r of due) {
        try {
            const res = await Rider.updateOne({ _id: r._id, isOnline: false, 'duty.resumeAt': { $lte: now } }, { $set: { isOnline: true, onlineSince: now, 'duty.autoSession': false }, $unset: { 'duty.resumeAt': 1 } });
            if (!res.modifiedCount) continue;
            require('./assignmentService').offerOpenToRider({ tenantId: r.tenantId, riderUserId: r.userId }).catch((e) => console.error('Show open orders error:', e.message));
            tell('rider_duty_auto', { tenantId: r.tenantId, userId: r.userId, vars: { on: true }, data: { kind: 'duty_auto' } });
        } catch (e) { console.error('Rider resume error:', e.message); }
    }
    return due.length;
}

// every minute: riders on "auto" go on and off duty by their timing
async function tick(now = new Date()) {
    await resumeTimed(now).catch((e) => console.error('Rider resume error:', e.message));
    const riders = await Rider.find({ isActive: true, 'duty.mode': 'auto' }).select('tenantId userId isOnline activeOrderCount duty holidays').lean();
    if (!riders.length) return { on: 0, off: 0 };
    const { date } = istNow(now);
    const tenantIds = [...new Set(riders.map((r) => String(r.tenantId)))];
    const [shops, leaves] = await Promise.all([
        Tenant.find({ _id: { $in: tenantIds } }).lean(),
        RiderLeave.find({ tenantId: { $in: tenantIds }, status: 'approved', from: { $lte: date }, to: { $gte: date } }).select('tenantId riderUserId from to').lean(),
    ]);
    const shopOf = new Map(shops.map((t) => [String(t._id), t]));
    const leaveOf = new Map(leaves.map((l) => [`${l.tenantId}:${l.riderUserId}`, l]));
    let on = 0;
    let off = 0;
    for (const r of riders) {
        try {
            const w = windowNow(r, now);
            const blocked = w.inWindow && (leaveOf.has(`${r.tenantId}:${r.userId}`) || (r.holidays || []).some((h) => covers(h, w.date)));
            const shouldBeOn = w.inWindow && !blocked;
            if (shouldBeOn && !r.isOnline) {
                const startedAlready = r.duty?.lastAutoOn && w.startAt && new Date(r.duty.lastAutoOn) >= w.startAt;
                if (startedAlready) continue;   // he went off duty by hand during his time: leave him off
                const shop = shopOf.get(String(r.tenantId));
                if (shop) {
                    const cfg = resolveConfig(shop);
                    if (!openStatus(cfg.hours.weekly, cfg.orders.acceptingOrders, now, cfg.hours.closedDates).isOpen) continue;   // wait until the shop opens
                }
                const res = await Rider.updateOne({ _id: r._id, isOnline: false, isActive: true }, { $set: { isOnline: true, onlineSince: now, 'duty.lastAutoOn': now, 'duty.autoSession': true } });
                if (res.modifiedCount) {
                    on += 1;
                    require('./assignmentService').offerOpenToRider({ tenantId: r.tenantId, riderUserId: r.userId }).catch((e) => console.error('Show open orders error:', e.message));   // open orders are shown to him at once
                    tell('rider_duty_auto', { tenantId: r.tenantId, userId: r.userId, vars: { on: true }, data: { kind: 'duty_auto' } });
                }
            } else if (!shouldBeOn && r.isOnline && r.duty?.autoSession && r.activeOrderCount === 0) {
                const res = await Rider.updateOne({ _id: r._id, isOnline: true, activeOrderCount: 0 }, { $set: { isOnline: false, 'duty.autoSession': false }, $unset: { onlineSince: 1 } });
                if (res.modifiedCount) {
                    off += 1;
                    tell('rider_duty_auto', { tenantId: r.tenantId, userId: r.userId, vars: { on: false, why: blocked ? 'leave' : 'end' }, data: { kind: 'duty_auto' } });
                }
            }
        } catch (e) {
            console.error('Rider schedule error:', e.message);
        }
    }
    return { on, off };
}

function startRiderScheduleTicker() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await tick(); } catch (e) { console.error('Rider schedule job error:', e.message); } finally { running = false; }
    };
    setTimeout(run, 20 * 1000).unref?.();
    setInterval(run, 60 * 1000).unref?.();
}

module.exports = {
    DAYS, MAX_HOLIDAYS, istNow, weeklyOf, cleanDuty, validDate, addDays, daysBetween, blockedOn, monthDays, summaries,
    requestLeave, cancelLeave, ownerRemove, decide, windowNow, tick, startRiderScheduleTicker, fail, resumeTime, resumeTimed,
};
