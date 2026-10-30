require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const tb = require('../src/services/tableBooking');

describe('table booking rules', () => {
    const base = { ...tb.DEFAULTS, tenantId: 'x', windows: [{ days: [], open: '19:00', close: '22:00' }, { days: ['sat'], open: '12:00', close: '14:00' }], slotMinutes: 60, minNoticeMinutes: 0, advanceDays: 10 };
    const NOW = new Date('2026-11-02T06:00:00Z').getTime();   // 11:30 in India, a Monday
    test('slots follow the windows and the day of the week', () => {
        assert.deepEqual(tb.slotsFor(base, '2026-11-03', NOW), ['19:00', '20:00', '21:00']);
        assert.deepEqual(tb.slotsFor(base, '2026-11-07', NOW), ['12:00', '13:00', '19:00', '20:00', '21:00']);   // a Saturday has lunch too
    });
    test('closed days, closed slots, past days and too far ahead give nothing', () => {
        assert.deepEqual(tb.slotsFor({ ...base, closedDates: ['2026-11-03'] }, '2026-11-03', NOW), []);
        assert.deepEqual(tb.slotsFor({ ...base, closedSlots: [{ date: '2026-11-03', time: '20:00' }] }, '2026-11-03', NOW), ['19:00', '21:00']);
        assert.deepEqual(tb.slotsFor(base, '2026-11-01', NOW), []);
        assert.deepEqual(tb.slotsFor(base, '2026-12-25', NOW), []);
    });
    test('a slot that starts too soon is hidden', () => {
        const soon = new Date('2026-11-03T13:00:00Z').getTime();   // 18:30 in India
        assert.deepEqual(tb.slotsFor({ ...base, minNoticeMinutes: 60 }, '2026-11-03', soon), ['20:00', '21:00']);
    });
    test('a slot that already started can still be booked while enough of it is left', () => {
        const at = (hhmm) => new Date(`2026-11-03T${hhmm}:00+05:30`).getTime();
        assert.deepEqual(tb.slotsFor({ ...base, minNoticeMinutes: 60 }, '2026-11-03', at('19:20')), ['19:00', '21:00']);   // 19:00 has 40 minutes left; 20:00 is inside the notice time
        assert.deepEqual(tb.slotsFor({ ...base, minNoticeMinutes: 60 }, '2026-11-03', at('19:40')), ['21:00']);            // only 20 minutes left of 19:00
    });
    test('the deposit is flat or per person', () => {
        assert.equal(tb.depositFor({ depositType: 'per_person', depositAmount: 200 }, 20), 4000);
        assert.equal(tb.depositFor({ depositType: 'flat', depositAmount: 500 }, 20), 500);
    });
    test('the settings are checked', () => {
        const cur = { ...tb.DEFAULTS, depositAmount: 100, tables: [{ no: '1', seats: 4, bookable: true }] };
        assert.throws(() => tb.cleanConfig({ enabled: true }, { ...tb.DEFAULTS, tables: cur.tables }), /deposit/);
        assert.throws(() => tb.cleanConfig({ enabled: true }, { ...cur, tables: [] }), /at least one table/);
        assert.throws(() => tb.cleanConfig({ enabled: true }, { ...cur, tables: [{ no: '1', seats: 4, bookable: false }] }), /at least one table/);
        assert.throws(() => tb.cleanConfig({ windows: [{ open: '22:00', close: '20:00' }] }, cur), /end after/);
        assert.throws(() => tb.cleanConfig({ windows: [{ open: '9am', close: '20:00' }] }, cur), /like 19:30/);
        assert.throws(() => tb.cleanConfig({ tables: [{ no: '1', seats: 4 }, { no: '1', seats: 2 }] }, cur), /listed twice/);
        assert.throws(() => tb.cleanConfig({ tables: [{ no: '', seats: 4 }] }, cur), /number or a name/);
        assert.throws(() => tb.cleanConfig({ tables: [{ no: '1', seats: 0 }] }, cur), /Seats of table 1/);
        assert.equal(tb.cleanConfig({ enabled: true }, cur).enabled, true);
        assert.deepEqual(tb.cleanConfig({ tables: [{ no: ' 7 ', seats: '6' }] }, cur).tables, [{ no: '7', seats: 6, bookable: true }]);
    });
    test('the biggest group follows the biggest table', () => {
        const c = { ...tb.DEFAULTS, maxParty: 12, tables: [{ no: '1', seats: 4, bookable: true }, { no: '2', seats: 6, bookable: true }, { no: '3', seats: 10, bookable: false }] };
        assert.equal(tb.maxPartyOf(c), 6);
    });
});
