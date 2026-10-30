require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const tb = require('../src/services/tableBooking');
const { makeWorld, makeUser } = require('./helpers/factory');

describe('table booking rules', () => {
    const base = { ...tb.DEFAULTS, tenantId: 'x', windows: [{ days: [], open: '19:00', close: '22:00' }, { days: ['sat'], open: '12:00', close: '14:00' }], slotMinutes: 60, minNoticeMinutes: 0, advanceDays: 10 };
    const NOW = new Date('2026-11-02T06:00:00Z').getTime();   // 11:30 in India, a Monday
    test('slots follow the windows and the day of the week', () => {
        assert.deepEqual(tb.slotsFor(base, '2026-11-03', NOW), ['19:00', '20:00', '21:00']);
        assert.deepEqual(tb.slotsFor(base, '2026-11-07', NOW), ['12:00', '13:00', '19:00', '20:00', '21:00']);   // a Saturday has lunch too
    });
    test('closed days, closed slots, past times and too far ahead give nothing', () => {
        assert.deepEqual(tb.slotsFor({ ...base, closedDates: ['2026-11-03'] }, '2026-11-03', NOW), []);
        assert.deepEqual(tb.slotsFor({ ...base, closedSlots: [{ date: '2026-11-03', time: '20:00' }] }, '2026-11-03', NOW), ['19:00', '21:00']);
        assert.deepEqual(tb.slotsFor(base, '2026-11-01', NOW), []);
        assert.deepEqual(tb.slotsFor(base, '2026-12-25', NOW), []);
    });
    test('a slot that starts too soon is hidden', () => {
        const soon = new Date('2026-11-03T13:00:00Z').getTime();   // 18:30 in India
        assert.deepEqual(tb.slotsFor({ ...base, minNoticeMinutes: 60 }, '2026-11-03', soon), ['20:00', '21:00']);
    });
    test('the deposit is flat or per person', () => {
        assert.equal(tb.depositFor({ depositType: 'per_person', depositAmount: 200 }, 20), 4000);
        assert.equal(tb.depositFor({ depositType: 'flat', depositAmount: 500 }, 20), 500);
    });
    test('the settings are checked', () => {
        const cur = { ...tb.DEFAULTS, depositAmount: 100 };
        assert.throws(() => tb.cleanConfig({ enabled: true }, { ...tb.DEFAULTS }), /deposit/);
        assert.throws(() => tb.cleanConfig({ windows: [{ open: '22:00', close: '20:00' }] }, cur), /end after/);
        assert.throws(() => tb.cleanConfig({ windows: [{ open: '9am', close: '20:00' }] }, cur), /like 19:30/);
        assert.throws(() => tb.cleanConfig({ maxParty: 30 }, { ...cur, seatsPerSlot: 20 }), /seats per slot/);
        assert.equal(tb.cleanConfig({ enabled: true }, cur).enabled, true);
    });
});

