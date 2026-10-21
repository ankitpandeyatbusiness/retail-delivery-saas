// A cook's or a waiter's own working time: Go live / Go off, weekly hours, and days off (holiday or leave). Like the owner's shop hours and a rider's duty,
// but for one person. Alerts (pushes and the live ting-tong) go only to the people who are ON DUTY right now.
//
//   Staff.duty = { online: true|false, mode: 'manual' | 'auto', weekly: { mon: { on, from: '09:00', to: '21:00' }, ... } }
//     manual  (default) on duty = the "Go live" switch (on by default, so nobody misses an alert after the owner adds them)
//     auto            on duty = inside the hours of the day (a night shift that ends after midnight works); "Go live" is not used
//   Staff.holidays = [{ from, to, note }]   days off (India dates, both ends included). No approval: the owner is told.
// When the SHOP is closed (the owner paused orders or went off duty, outside the shop's hours, a closed day, suspended, in maintenance, unpaid bill) nobody
// is on duty, whatever their own switch or hours say, and nobody can go live: they can again when the shop opens.
// One exception, so food is never left half made: while the shop is closed but this job still has work in hand (a cook: orders accepted and not finished;
// a waiter: dine in orders and open tables), the person stays on duty to finish it ("winding down"). When the work is done the shop counts as closed for them.
// Nothing here changes what a person can SEE: an off-duty cook still opens the app. It only decides who gets told.
const { httpError } = require('../middlewares/apiErrors');
const Staff = require('../models/Staff');
const Tenant = require('../models/Tenant');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const IST_MS = 330 * 60000;
const MAX_HOLIDAYS = 20;
const MAX_DAYS = 31;
const DEFAULT_DAY = { on: false, from: '09:00', to: '21:00' };

const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

function istNow(now = new Date()) {
    const ist = new Date(now.getTime() + IST_MS);
    return { date: ist.toISOString().slice(0, 10), mins: ist.getUTCHours() * 60 + ist.getUTCMinutes(), dow: ist.getUTCDay() };
}

const weeklyOf = (row) => Object.fromEntries(DAYS.map((d) => [d, { ...DEFAULT_DAY, ...(row?.duty?.weekly?.[d] || {}) }]));
const onHoliday = (row, date) => (row?.holidays || []).some((h) => h.from <= date && date <= h.to);

// is `now` inside this person's hours?
function inHours(row, now) {
    const weekly = weeklyOf(row);
    const { mins, dow } = istNow(now);
    const today = weekly[DAYS[dow]];
    if (today.on) {
        const f = toMin(today.from);
        const t = toMin(today.to);
        if (t > f ? mins >= f && mins < t : mins >= f) return true;
    }
    const y = weekly[DAYS[(dow + 6) % 7]];   // last night's shift still running
    return y.on && toMin(y.to) <= toMin(y.from) && mins < toMin(y.to);
}

// is the shop closed right now? (its hours and closed days, the owner's pause, suspended, maintenance, unpaid bill)
function shopClosed(tenant, now = new Date()) {
    if (!tenant) return false;
    try {
        const { resolveConfig, openStatus } = require('./tenantConfigService');
        const cfg = resolveConfig(tenant);
        if (!openStatus(cfg.hours.weekly, cfg.orders.acceptingOrders, now, cfg.hours.closedDates).isOpen) return true;
        return !require('../utils/shopState').shopState(tenant).acceptingOrders;
    } catch (e) { return false; }   // never lock a crew out because of a bug: an unreadable shop counts as open
}

// does this job still have work in hand? (cook: accepted or cooking orders; waiter: dine in orders that are not served yet, and open tables)
async function hasWork(tenantId, role) {
    const Order = require('../models/Order');
    if (role === 'kitchen') return !!(await Order.exists({ tenantId, status: { $in: ['accepted', 'preparing'] }, 'kitchen.readyAt': { $exists: false } }));
    const TableSession = require('../models/TableSession');
    const [o, t] = await Promise.all([
        Order.exists({ tenantId, orderType: 'dine_in', status: { $in: ['accepted', 'preparing', 'ready'] } }),
        TableSession.exists({ tenantId, kind: { $ne: 'pickup' }, status: { $in: ['open', 'bill_asked'] } }),
    ]);
    return !!(o || t);
}
// { closed, winding }: closed = nobody on duty for this job; winding = the shop is closed but this job is finishing its work
async function closedFor(tenant, role, now = new Date()) {
    if (!shopClosed(tenant, now)) return { closed: false, winding: false };
    const work = await hasWork(tenant._id, role).catch(() => false);
    return { closed: !work, winding: work };
}

// 'on' | 'off' (switched off by hand) | 'outside' (outside his hours) | 'holiday' | 'shop_closed'
function statusOf(row, now = new Date(), closed = false) {
    if (closed) return 'shop_closed';
    if (onHoliday(row, istNow(now).date)) return 'holiday';
    if ((row?.duty?.mode || 'manual') === 'auto') return inHours(row, now) ? 'on' : 'outside';
    return row?.duty?.online === false ? 'off' : 'on';
}
const isOnDuty = (row, now = new Date(), closed = false) => row?.isActive !== false && statusOf(row, now, closed) === 'on';

function cleanDuty(body) {
    const b = body || {};
    const out = {};
    if (b.online !== undefined) {
        if (typeof b.online !== 'boolean') throw httpError(400, 'online must be true or false');
        out.online = b.online;
    }
    if (b.mode !== undefined) {
        if (!['manual', 'auto'].includes(b.mode)) throw httpError(400, 'mode must be manual or auto');
        out.mode = b.mode;
    }
    if (b.weekly !== undefined) {
        if (!b.weekly || typeof b.weekly !== 'object') throw httpError(400, 'weekly must be an object');
        out.weekly = {};
        for (const d of DAYS) {
            const v = b.weekly[d];
            if (v === undefined) continue;
            if (typeof v.on !== 'boolean') throw httpError(400, `${d}: send on true or false`);
            if (!validTime(v.from) || !validTime(v.to)) throw httpError(400, `${d}: times must look like 09:00`);
            if (v.from === v.to) throw httpError(400, `${d}: the start and the end time must differ`);
            out.weekly[d] = { on: v.on, from: v.from, to: v.to };
        }
    }
    return out;
}

// what the app shows
function viewOf(row, now = new Date(), closed = false, winding = false) {
    const { date } = istNow(now);
    const holidays = (row?.holidays || []).filter((h) => h.to >= date).sort((a, b) => (a.from < b.from ? -1 : 1))
        .map((h) => ({ id: String(h._id), from: h.from, to: h.to, note: h.note || '', days: daysBetween(h.from, h.to), leave: !!h.leaveId }));
    return {
        status: statusOf(row, now, closed), onDuty: isOnDuty(row, now, closed), shopClosed: closed, winding,
        online: row?.duty?.online !== false, mode: row?.duty?.mode || 'manual', weekly: weeklyOf(row),
        holidays, today: { holiday: onHoliday(row, date), date },
    };
}

function cleanHoliday(body, now = new Date()) {
    const { from, to } = body || {};
    if (!validDate(from) || !validDate(to)) throw httpError(400, 'Choose the first and the last day');
    if (to < from) throw httpError(400, 'The last day cannot be before the first day');
    if (to < istNow(now).date) throw httpError(400, 'These days are already over');
    if (daysBetween(from, to) > MAX_DAYS) throw httpError(400, `A holiday can be at most ${MAX_DAYS} days`);
    return { from, to, note: String(body.note || '').trim().slice(0, 80) };
}

// the people of one job who are on duty right now (nobody while the shop is closed)
async function peopleOnDuty(tenantId, role, now = new Date()) {
    const [rows, tenant] = await Promise.all([
        Staff.find({ tenantId, role, isActive: true }).select('userId prefs duty holidays').lean(),
        Tenant.findById(tenantId).lean(),
    ]);
    const { closed } = tenant ? await closedFor(tenant, role, now) : { closed: false };
    return rows.filter((r) => isOnDuty(r, now, closed));
}

module.exports = { statusOf, isOnDuty, shopClosed, closedFor, peopleOnDuty, viewOf, cleanDuty, cleanHoliday, weeklyOf, MAX_HOLIDAYS };
