require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const { pickupSlots } = require('../src/services/pickupSlots');

// The pickup windows: only windows that have not begun are offered, and a window never goes outside the shop's opening hours.
let w; let seq = 0;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => { await db.clear(); w = await f.makeWorld('slots-shop-' + (++seq)); });

const IST = 330 * 60000;
// India time on a fixed Wednesday, 21 Oct 2026
const at = (h, m = 0, d = 21) => new Date(Date.UTC(2026, 9, d, h, m) - IST);
const hours = async (from, to) => {
    const day = [{ open: from, close: to }];
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.hours.weekly': { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day } } });
    return Tenant.findById(w.tenant._id).lean();
};
const labels = (r, day = 'Today') => r.slots.filter((x) => x.dayLabel === day).map((x) => x.label);

describe('pickup windows', () => {
    test('at 8 PM the 7-9 PM window is gone; the next one is 9 PM (when the shop is still open)', async () => {
        const t = await hours('10:00', '23:00');
        const r = pickupSlots(t, at(20, 0));
        assert.equal(r.open, true, JSON.stringify(r));
        assert.deepEqual(labels(r), ['9 PM – 11 PM']);
        assert.ok(!labels(r).some((x) => x.startsWith('7 PM')));
    });

    test('earlier in the day the windows run from now on, and are cut at opening and closing time', async () => {
        const t = await hours('10:00', '22:00');
        const morning = pickupSlots(t, at(10, 30));
        assert.deepEqual(labels(morning).slice(0, 2), ['11 AM – 1 PM', '1 PM – 3 PM'], 'the 9-11 window had already begun');
        const tomorrow = labels(morning, 'Tomorrow');
        assert.equal(tomorrow[0], '10 AM – 11 AM', 'tomorrow starts at the opening time, not at 9');
        const evening = pickupSlots(t, at(19, 30));
        assert.deepEqual(labels(evening), ['9 PM – 10 PM'], 'the last window ends at the closing time');
    });

    test('a window that has begun is never offered, to the minute', async () => {
        const t = await hours('09:00', '23:00');
        const r = pickupSlots(t, at(13, 0));
        assert.ok(!labels(r).includes('1 PM – 3 PM') || r.slots[0].from >= at(13, 0).toISOString(), 'a window starting exactly now is the next one');
        const later = pickupSlots(t, at(13, 1));
        assert.ok(!labels(later).includes('1 PM – 3 PM'));
    });
});
