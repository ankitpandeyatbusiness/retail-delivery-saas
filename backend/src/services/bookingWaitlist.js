// The waitlist of a full slot. A guest who wants a table in a slot with no free table joins it; when a table of that slot comes free again (a booking
// was cancelled, an unpaid hold was let go, the owner denied one, or a guest finished early) the waiting guests are told, oldest first.
// Nobody is promised the table: it goes to whoever books first (the locks in services/tableBooking.js decide).
const { httpError } = require('../middlewares/apiErrors');
const WaitlistEntry = require('../models/WaitlistEntry');
const tb = require('./tableBooking');

const tell = (event, ctx) => Promise.resolve().then(() => require('../notifications/center').notify(event, ctx)).catch((e) => console.error('Notification error:', e.message));
const RENOTIFY_MS = 10 * 60000;   // a guest is not told again within ten minutes

// Only for a slot that really has no free table for his group (otherwise he should simply book).
async function join({ config, userId, name, phone, date, time, party }) {
    party = Math.round(Number(party));
    if (!Number.isFinite(party) || party < config.minParty || party > tb.maxPartyOf(config)) throw httpError(400, `We take groups of ${config.minParty} to ${tb.maxPartyOf(config)}`);
    const slot = (await tb.availability(config, date, party)).find((s) => s.time === time);
    if (!slot) throw httpError(400, 'That time cannot be booked. Please pick another.');
    if (slot.noFit) throw httpError(400, 'No table is big enough for this group.');
    if (slot.ok) throw httpError(409, 'A table is free for this time. Book it now.');
    return WaitlistEntry.findOneAndUpdate(
        { tenantId: config.tenantId, userId, date, time },
        { $set: { name: String(name || '').trim().slice(0, 80), phone: String(phone || '').trim().slice(0, 20), party, status: 'waiting' }, $unset: { notifiedAt: 1 } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
}

const leave = (tenantId, userId, id) => WaitlistEntry.updateOne({ _id: id, tenantId, userId, status: 'waiting' }, { $set: { status: 'left' } });
const markBooked = (tenantId, userId, date, time) => WaitlistEntry.updateMany({ tenantId, userId, date, time, status: 'waiting' }, { $set: { status: 'booked' } });
const mine = (tenantId, userId) => WaitlistEntry.find({ tenantId, userId, status: 'waiting' }).sort({ date: 1, time: 1 }).lean();

// A table of this slot came free: tell the waiting guests whose group fits one of the free tables, oldest first.
async function notifyFreed(tenantId, date, time, now = Date.now()) {
    const config = await tb.getConfig(tenantId);
    const free = (await tb.tablesFor(config, date, time, 1, now)).filter((t) => t.state !== 'taken');
    if (!free.length) return 0;
    const waiting = await WaitlistEntry.find({ tenantId, date, time, status: 'waiting' }).sort({ createdAt: 1 }).limit(20);
    if (!waiting.length) return 0;
    const shop = (await require('../models/Tenant').findById(tenantId).select('name').lean())?.name || '';
    const cutoff = new Date(now - RENOTIFY_MS);
    let sent = 0;
    for (const e of waiting) {
        if (sent >= free.length * 2) break;   // a couple of guests per free table: the rest are told when more come free
        if (!free.some((t) => t.seats >= e.party)) continue;
        const claimed = await WaitlistEntry.findOneAndUpdate({ _id: e._id, status: 'waiting', $or: [{ notifiedAt: { $exists: false } }, { notifiedAt: { $lte: cutoff } }] }, { $set: { notifiedAt: new Date(now) } });
        if (!claimed) continue;
        tell('booking_waitlist_free', { tenantId, userId: e.userId, vars: { shop, date, time, party: e.party }, data: { kind: 'booking_waitlist', date, time } });
        sent += 1;
    }
    return sent;
}

// Run every minute: entries for days that have passed are closed.
const expireOld = (now = Date.now()) => WaitlistEntry.updateMany({ status: 'waiting', date: { $lt: tb.todayYmd(now) } }, { $set: { status: 'expired' } });

module.exports = { join, leave, markBooked, mine, notifyFreed, expireOld };
