// Table booking, cinema style: the guest picks a day, a time and a TABLE. This file holds the shop's rules, the slots, which tables are free, and
// the locks that make double booking impossible. All dates and times are India time ("YYYY-MM-DD", "HH:MM").
//   - A booking takes ONE table for ONE slot (the slot length is how long a booking lasts).
//   - The database enforces it: one row per table and slot, and one row per guest and time (BookingTableLock, BookingUserLock). Of two guests who
//     ask for the same table at the same moment, exactly one gets it. The same guest cannot hold two tables for the same time either.
//   - A guest who finishes early (his table bill is paid and the visit is closed) frees the table for the rest of the slot (freeFinished).
const mongoose = require('mongoose');
const { httpError } = require('../middlewares/apiErrors');
const TableBookingConfig = require('../models/TableBookingConfig');
const TableBooking = require('../models/TableBooking');
const BookingTableLock = require('../models/BookingTableLock');
const BookingUserLock = require('../models/BookingUserLock');
const TableSession = require('../models/TableSession');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST_MS = 330 * 60 * 1000;
const LIVE = ['confirmed', 'seated'];   // bookings that hold a table
const OPEN = ['open', 'bill_asked'];    // a table visit in progress
const RUNNING_MIN = 30;                 // a slot that already started can still be booked when at least this many minutes are left

const DEFAULTS = {
    enabled: false, windows: [{ days: [], open: '12:00', close: '22:00' }], slotMinutes: 60, tables: [], minParty: 1, maxParty: 12,
    advanceDays: 14, minNoticeMinutes: 60, closedDates: [], closedSlots: [], depositType: 'per_person', depositAmount: 0,
    depositMode: 'adjust', refundHours: 2, holdMinutes: 10,
};

const istNow = (now = Date.now()) => new Date(now + IST_MS);
const todayYmd = (now) => istNow(now).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dayKey = (ymd) => DAY_KEYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
const startsAtOf = (date, time) => new Date(`${date}T${time}:00+05:30`);
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });

async function getConfig(tenantId) {
    const doc = await TableBookingConfig.findOne({ tenantId }).lean();
    const c = { ...DEFAULTS, ...(doc || {}), tenantId };
    c.tables = [...(c.tables || [])].sort(byNo);
    // the shop's own opening hours and holidays also limit booking: nobody can book a table when the shop is shut
    try {
        const tenant = await require('../models/Tenant').findById(tenantId).select('settings').lean();
        const h = require('./tenantConfigService').resolveConfig(tenant || {}).hours || {};
        c.shopHours = { weekly: h.weekly || {}, closedDates: h.closedDates || [] };
    } catch (e) { c.shopHours = null; }
    return c;
}

const int = (v, lo, hi, what) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < lo || n > hi) throw httpError(400, `${what}: a number from ${lo} to ${hi}`);
    return n;
};

// What the owner may save. Anything not sent stays as it is (so the slider can send only { enabled }).
function cleanConfig(body, current) {
    const b = body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    const out = {};
    if (has('windows')) {
        if (!Array.isArray(b.windows) || b.windows.length > 6) throw httpError(400, 'Up to 6 booking times');
        out.windows = b.windows.map((w) => {
            const days = Array.isArray(w.days) ? w.days.filter((d) => DAY_KEYS.includes(d)) : [];
            if (!TIME_RE.test(w.open || '') || !TIME_RE.test(w.close || '')) throw httpError(400, 'Type each time like 19:30');
            if (toMin(w.open) >= toMin(w.close)) throw httpError(400, 'A booking time must end after it starts');
            return { days, open: w.open, close: w.close };
        });
    }
    if (has('tables')) {
        const list = Array.isArray(b.tables) ? b.tables : [];
        if (list.length > 80) throw httpError(400, 'Up to 80 tables');
        const seen = new Set();
        out.tables = list.map((t) => {
            const no = String(t?.no ?? '').trim().slice(0, 10);
            if (!no) throw httpError(400, 'Every table needs a number or a name');
            if (seen.has(no)) throw httpError(400, `Table ${no} is listed twice`);
            seen.add(no);
            return { no, seats: int(t.seats, 1, 50, `Seats of table ${no}`), bookable: t.bookable !== false };
        });
    }
    if (has('slotMinutes')) out.slotMinutes = int(b.slotMinutes, 15, 240, 'Booking length');
    if (has('minParty')) out.minParty = int(b.minParty, 1, 200, 'Smallest group');
    if (has('maxParty')) out.maxParty = int(b.maxParty, 1, 200, 'Largest group');
    if (has('advanceDays')) out.advanceDays = int(b.advanceDays, 1, 90, 'Days ahead');
    if (has('minNoticeMinutes')) out.minNoticeMinutes = int(b.minNoticeMinutes, 0, 1440, 'Notice');
    if (has('closedDates')) {
        const list = Array.isArray(b.closedDates) ? b.closedDates : [];
        if (list.length > 120 || list.some((d) => !DATE_RE.test(d))) throw httpError(400, 'Closed days must be dates like 2026-11-01');
        out.closedDates = [...new Set(list)].sort();
    }
    if (has('closedSlots')) {
        const list = Array.isArray(b.closedSlots) ? b.closedSlots : [];
        if (list.length > 200 || list.some((s) => !DATE_RE.test(s?.date || '') || !TIME_RE.test(s?.time || ''))) throw httpError(400, 'A closed slot needs a date and a time');
        out.closedSlots = list.map((s) => ({ date: s.date, time: s.time }));
    }
    if (has('depositType')) { if (!['flat', 'per_person'].includes(b.depositType)) throw httpError(400, 'Unknown deposit type'); out.depositType = b.depositType; }
    if (has('depositAmount')) out.depositAmount = int(b.depositAmount, 0, 100000, 'Deposit');
    if (has('depositMode')) { if (!['adjust', 'keep'].includes(b.depositMode)) throw httpError(400, 'Unknown deposit rule'); out.depositMode = b.depositMode; }
    if (has('refundHours')) out.refundHours = int(b.refundHours, 0, 168, 'Refund hours');
    if (has('holdMinutes')) out.holdMinutes = int(b.holdMinutes, 5, 30, 'Hold minutes');
    if (has('enabled')) out.enabled = !!b.enabled;

    const next = { ...current, ...out };
    if (next.minParty > next.maxParty) throw httpError(400, 'The smallest group cannot be bigger than the largest');
    if (next.enabled && !(next.depositAmount > 0)) throw httpError(400, 'Table booking works with a deposit, so a booking counts only once it is paid. Set the deposit amount first, then switch booking on');
    if (next.enabled && !next.windows.length) throw httpError(400, 'Add the times guests can book before you switch booking on');
    if (next.enabled && !(next.tables || []).some((t) => t.bookable)) throw httpError(400, 'Add at least one table guests can book before you switch booking on');
    return out;
}

const depositFor = (config, party) => (config.depositType === 'per_person' ? config.depositAmount * party : config.depositAmount);
const bookable = (config) => (config.tables || []).filter((t) => t.bookable);
// the largest group any table can take (the customer screens use it to cap the group size)
const biggestTable = (config) => bookable(config).reduce((m, t) => Math.max(m, t.seats), 0);
const maxPartyOf = (config) => Math.min(config.maxParty, biggestTable(config) || config.maxParty);

// Every start time of a day by the shop's rules (before looking at what is taken). Empty when the day is closed or out of range.
function slotTimes(config, date, now = Date.now()) {
    if (!DATE_RE.test(date || '')) throw httpError(400, 'Pick a date');
    const today = todayYmd(now);
    if (date < today || date > addDays(today, config.advanceDays)) return [];
    if ((config.closedDates || []).includes(date)) return [];
    const key = dayKey(date);
    const sh = config.shopHours;
    if (sh && (sh.closedDates || []).some((r) => date >= r.from && date <= r.to)) return [];   // a holiday of the shop
    const shopDay = sh?.weekly?.[key];   // undefined: no hours set for that day, so no limit. Empty: the shop is closed that day
    if (Array.isArray(shopDay) && !shopDay.length) return [];
    const inShopHours = (m) => !Array.isArray(shopDay) || shopDay.some((x) => {
        const o = toMin(x.open); const c = toMin(x.close);
        return m >= o && m + config.slotMinutes <= (c <= o ? c + 1440 : c);
    });
    const times = new Set();
    for (const w of config.windows || []) {
        if (w.days?.length && !w.days.includes(key)) continue;
        for (let m = toMin(w.open); m + config.slotMinutes <= toMin(w.close); m += config.slotMinutes) if (inShopHours(m)) times.add(toTime(m));
    }
    const closed = new Set((config.closedSlots || []).filter((s) => s.date === date).map((s) => s.time));
    return [...times].sort().filter((t) => !closed.has(t));
}

// The slots a guest may pick: far enough ahead, or a slot that already started and still has time left (then the table must be empty right now).
const isRunning = (date, time, now) => startsAtOf(date, time).getTime() <= now;
function slotsFor(config, date, now = Date.now()) {
    const earliest = now + config.minNoticeMinutes * 60000;
    return slotTimes(config, date, now).filter((t) => {
        const s = startsAtOf(date, t).getTime();
        return s >= earliest || (s <= now && s + config.slotMinutes * 60000 - now >= RUNNING_MIN * 60000);
    });
}

// the table numbers with a visit in progress right now (a slot that already started cannot give those out)
async function inUseNow(tenantId) {
    return new Set((await TableSession.find({ tenantId, status: { $in: OPEN }, kind: { $ne: 'pickup' } }).select('table').lean()).map((s) => String(s.table)));
}

// The tables of one slot as the guest sees them: free, taken (booked, or in use right now), or too small for his group.
async function tablesFor(config, date, time, party, now = Date.now()) {
    if (!slotsFor(config, date, now).includes(time)) return [];
    const taken = new Set((await BookingTableLock.find({ tenantId: config.tenantId, date, time }).select('table').lean()).map((l) => l.table));
    const busy = isRunning(date, time, now) ? await inUseNow(config.tenantId) : new Set();
    return bookable(config).map((t) => ({
        no: t.no, seats: t.seats,
        state: taken.has(String(t.no)) || busy.has(String(t.no)) ? 'taken' : t.seats < party ? 'small' : 'free',
    }));
}

// The slots of a day: how many tables fit the group and are free. full = no table is free (the guest may join the waitlist); noFit = no table is big enough.
async function availability(config, date, party, now = Date.now()) {
    const times = slotsFor(config, date, now);
    if (!times.length) return [];
    const fit = bookable(config).filter((t) => t.seats >= party);
    const locks = await BookingTableLock.find({ tenantId: config.tenantId, date, time: { $in: times } }).select('time table').lean();
    const taken = new Map();
    for (const l of locks) { if (!taken.has(l.time)) taken.set(l.time, new Set()); taken.get(l.time).add(l.table); }
    const busy = times.some((t) => isRunning(date, t, now)) ? await inUseNow(config.tenantId) : new Set();
    return times.map((time) => {
        const gone = taken.get(time) || new Set();
        const free = fit.filter((t) => !gone.has(String(t.no)) && !(isRunning(date, time, now) && busy.has(String(t.no)))).length;
        return { time, free, ok: free > 0, full: fit.length > 0 && free === 0, noFit: fit.length === 0 };
    });
}

// Takes the table and the guest's time, or says why not. Two rows, two unique indexes: of any two callers for the same table (or the same guest
// at the same time) the database lets exactly one in.
async function lock({ tenantId, userId, date, time, table, bookingId }) {
    await Promise.all([BookingUserLock.init(), BookingTableLock.init()]);   // the unique indexes must exist before the first insert
    try { await BookingUserLock.create({ tenantId, userId, date, time, bookingId }); } catch (e) { if (e.code === 11000) return 'user'; throw e; }
    try { await BookingTableLock.create({ tenantId, date, time, table: String(table), bookingId }); } catch (e) {
        await BookingUserLock.deleteOne({ bookingId });
        if (e.code === 11000) return 'table';
        throw e;
    }
    return 'ok';
}
const unlock = (bookingId) => Promise.all([BookingTableLock.deleteOne({ bookingId }), BookingUserLock.deleteOne({ bookingId })]);

// A booking gives its table back (cancelled, let go, or the guest left early). Guests waiting for this slot are told.
async function release(b) {
    await unlock(b._id);
    require('./bookingWaitlist').notifyFreed(b.tenantId, b.date, b.time).catch((e) => console.error('Waitlist error:', e.message));
}
// takes the same table again for a booking that was let go and then paid (services/bookingPayment.js confirm)
const relock = (b) => lock({ tenantId: b.tenantId, userId: b.userId, date: b.date, time: b.time, table: b.table, bookingId: b._id });

const newCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

async function book({ config, userId, name, phone, date, time, party, table, note, now = Date.now() }) {
    party = Math.round(Number(party));
    if (!Number.isFinite(party) || party < config.minParty || party > maxPartyOf(config)) throw httpError(400, `We take groups of ${config.minParty} to ${maxPartyOf(config)}`);
    const t = bookable(config).find((x) => String(x.no) === String(table));
    if (!t) throw httpError(400, 'Pick a table');
    if (party > t.seats) throw httpError(400, `Table ${t.no} seats ${t.seats}. Pick a bigger table.`);
    if (!slotsFor(config, date, now).includes(time)) throw httpError(400, 'That time cannot be booked. Please pick another.');
    if (isRunning(date, time, now) && (await inUseNow(config.tenantId)).has(String(t.no))) throw httpError(409, `Table ${t.no} is in use right now. Please pick another.`);

    const _id = new mongoose.Types.ObjectId();
    const got = await lock({ tenantId: config.tenantId, userId, date, time, table: t.no, bookingId: _id });
    if (got === 'user') throw httpError(409, 'You already have a booking at this time. Cancel it first, or pick another time.');
    if (got === 'table') throw httpError(409, `Sorry, table ${t.no} was just taken. Please pick another table.`);
    const startsAt = startsAtOf(date, time);
    try {
        return await TableBooking.create({
            _id, tenantId: config.tenantId, userId, code: newCode(), name, phone, date, time, table: String(t.no), startsAt, endsAt: new Date(startsAt.getTime() + config.slotMinutes * 60000), party,
            note: String(note || '').trim().slice(0, 300), deposit: { amount: depositFor(config, party), status: 'unpaid' },
            status: 'held', holdUntil: new Date(now + config.holdMinutes * 60000), rules: { refundHours: config.refundHours, depositMode: config.depositMode },
        });
    } catch (e) {
        await unlock(_id);   // give the table back
        throw e;
    }
}

// Cancels a booking that still holds a table (waiting for its deposit, or confirmed) and gives the table back. Returns the booking, or null when it was not cancellable.
// The money side (refund or keep) is bookingPayment.cancelBooking.
async function cancel(booking, by) {
    const done = await TableBooking.findOneAndUpdate({ _id: booking._id, status: { $in: ['held', 'confirmed'] } }, { $set: { status: 'cancelled', cancelledBy: by, cancelledAt: new Date() } }, { returnDocument: 'after' });
    if (done) await release(done);
    return done;
}

// The guest left early: his table bill is paid and the visit is closed (or the owner says the table is free), so the rest of the slot is free for others.
async function freeTable(booking, now = new Date()) {
    const done = await TableBooking.findOneAndUpdate({ _id: booking._id, status: 'seated', freedAt: { $exists: false } }, { $set: { freedAt: now } }, { returnDocument: 'after' });
    if (done && done.endsAt.getTime() > now.getTime()) await release(done);
    return done;
}
// Run every minute: seated guests whose table visit has closed give their table back for the rest of the slot.
async function freeFinished(now = new Date()) {
    const seated = await TableBooking.find({ status: 'seated', sessionId: { $exists: true }, freedAt: { $exists: false }, endsAt: { $gt: now } }).limit(100);
    if (!seated.length) return 0;
    const closed = new Set((await TableSession.find({ _id: { $in: seated.map((b) => b.sessionId) }, status: 'closed' }).select('_id').lean()).map((s) => String(s._id)));
    let n = 0;
    for (const b of seated) if (closed.has(String(b.sessionId)) && (await freeTable(b, now))) n += 1;
    return n;
}

module.exports = {
    DEFAULTS, LIVE, getConfig, cleanConfig, depositFor, bookable, biggestTable, maxPartyOf, slotTimes, slotsFor, tablesFor, availability,
    lock, unlock, relock, release, book, cancel, freeTable, freeFinished, todayYmd, addDays, startsAtOf,
};
