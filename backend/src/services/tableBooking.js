// Table booking: the shop's rules, the slots a guest can pick, and taking seats without ever overbooking.
// All dates and times are India time ("YYYY-MM-DD", "HH:MM"). A booking holds its seats in the slot it starts in.
const { httpError } = require('../middlewares/apiErrors');
const TableBookingConfig = require('../models/TableBookingConfig');
const TableBooking = require('../models/TableBooking');
const BookingSlotUse = require('../models/BookingSlotUse');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST_MS = 330 * 60 * 1000;
const LIVE = ['confirmed', 'seated'];   // bookings that hold seats

const DEFAULTS = {
    enabled: false, windows: [{ days: [], open: '12:00', close: '22:00' }], slotMinutes: 60, seatsPerSlot: 20, minParty: 1, maxParty: 12,
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

async function getConfig(tenantId) {
    const doc = await TableBookingConfig.findOne({ tenantId }).lean();
    return { ...DEFAULTS, ...(doc || {}), tenantId };
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
    if (has('slotMinutes')) out.slotMinutes = int(b.slotMinutes, 15, 240, 'Slot length');
    if (has('seatsPerSlot')) out.seatsPerSlot = int(b.seatsPerSlot, 1, 2000, 'Seats per slot');
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
    if (next.maxParty > next.seatsPerSlot) throw httpError(400, 'The largest group cannot be bigger than the seats per slot');
    if (next.enabled && !(next.depositAmount > 0)) throw httpError(400, 'Set the deposit guests must pay before you switch booking on');
    if (next.enabled && !next.windows.length) throw httpError(400, 'Add the times guests can book before you switch booking on');
    return out;
}

const depositFor = (config, party) => (config.depositType === 'per_person' ? config.depositAmount * party : config.depositAmount);

// The start times a guest could pick on this day, before any seat is counted. Empty when the day is closed or out of range.
function slotsFor(config, date, now = Date.now()) {
    if (!DATE_RE.test(date || '')) throw httpError(400, 'Pick a date');
    const today = todayYmd(now);
    if (date < today || date > addDays(today, config.advanceDays)) return [];
    if ((config.closedDates || []).includes(date)) return [];
    const key = dayKey(date);
    const times = new Set();
    for (const w of config.windows || []) {
        if (w.days?.length && !w.days.includes(key)) continue;
        for (let m = toMin(w.open); m + config.slotMinutes <= toMin(w.close); m += config.slotMinutes) times.add(toTime(m));
    }
    const closed = new Set((config.closedSlots || []).filter((s) => s.date === date).map((s) => s.time));
    const earliest = now + config.minNoticeMinutes * 60000;
    return [...times].sort().filter((t) => !closed.has(t) && startsAtOf(date, t).getTime() >= earliest);
}

// The slots of a day with how many seats are left in each; ok = the group of `party` fits.
async function availability(config, date, party, now) {
    const times = slotsFor(config, date, now);
    if (!times.length) return [];
    const used = await BookingSlotUse.find({ tenantId: config.tenantId, date, time: { $in: times } }).lean();
    const taken = new Map(used.map((u) => [u.time, u.seats]));
    return times.map((time) => { const left = Math.max(0, config.seatsPerSlot - (taken.get(time) || 0)); return { time, left, ok: party > 0 && left >= party }; });
}

// Takes `party` seats in a slot only if they are still free. Safe when two guests ask at the same moment.
async function reserve(tenantId, date, time, party, cap) {
    if (party > cap) return false;
    try {
        return !!(await BookingSlotUse.findOneAndUpdate({ tenantId, date, time, seats: { $lte: cap - party } }, { $inc: { seats: party } }, { upsert: true, returnDocument: 'after' }));
    } catch (e) {
        if (e.code === 11000) return false;   // the counter exists and is too full
        throw e;
    }
}
const release = (b) => BookingSlotUse.updateOne({ tenantId: b.tenantId, date: b.date, time: b.time }, { $inc: { seats: -b.party } });

const newCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');

async function book({ config, userId, name, phone, date, time, party, note, now = Date.now() }) {
    party = Math.round(Number(party));
    if (!Number.isFinite(party) || party < config.minParty || party > config.maxParty) throw httpError(400, `We take groups of ${config.minParty} to ${config.maxParty}`);
    if (!slotsFor(config, date, now).includes(time)) throw httpError(400, 'That time cannot be booked. Please pick another.');
    if (!(await reserve(config.tenantId, date, time, party, config.seatsPerSlot))) throw httpError(409, 'Sorry, that time just filled up. Please pick another.');
    try {
        return await TableBooking.create({
            tenantId: config.tenantId, userId, code: newCode(), name, phone, date, time, startsAt: startsAtOf(date, time), endsAt: new Date(startsAtOf(date, time).getTime() + config.slotMinutes * 60000), party,
            note: String(note || '').trim().slice(0, 300), deposit: { amount: depositFor(config, party), status: 'unpaid' },
            status: 'held', holdUntil: new Date(now + config.holdMinutes * 60000), rules: { refundHours: config.refundHours, depositMode: config.depositMode },
        });
    } catch (e) {
        await BookingSlotUse.updateOne({ tenantId: config.tenantId, date, time }, { $inc: { seats: -party } });   // give the seats back
        throw e;
    }
}

// Cancels a booking that still holds seats (waiting for its deposit, or confirmed) and gives them back. Returns the booking, or null when it was not cancellable.
// The money side (refund or keep) is bookingPayment.cancelBooking.
async function cancel(booking, by) {
    const done = await TableBooking.findOneAndUpdate({ _id: booking._id, status: { $in: ['held', 'confirmed'] } }, { $set: { status: 'cancelled', cancelledBy: by, cancelledAt: new Date() } }, { returnDocument: 'after' });
    if (done) await release(done);
    return done;
}

module.exports = { DEFAULTS, LIVE, reserve, release, getConfig, cleanConfig, depositFor, slotsFor, availability, book, cancel, todayYmd, addDays, startsAtOf };
