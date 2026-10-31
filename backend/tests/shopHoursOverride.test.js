require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { openStatus, nextHoursChange, forceOpenUntil, resolveConfig } = require('../src/services/tenantConfigService');

const day = [{ open: '10:00', close: '22:00' }];
const weekly = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
const at = (s) => new Date(`${s}+05:30`);

describe('opening the shop against its hours', () => {
    test('the next change of the hours is the opening or the closing time', () => {
        assert.equal(nextHoursChange(weekly, [], at('2026-11-02T23:00:00')).toISOString(), at('2026-11-03T10:00:00').toISOString());   // closed now: next is the opening
        assert.equal(nextHoursChange(weekly, [], at('2026-11-02T15:00:00')).toISOString(), at('2026-11-02T22:00:00').toISOString());   // open now: next is the closing
        assert.equal(nextHoursChange({}, [], at('2026-11-02T15:00:00')), null);                                                       // no hours: they never change
    });
    test('an opening by hand holds only between its two moments, and the pause beats it', () => {
        const from = at('2026-11-02T23:00:00');
        const until = forceOpenUntil(weekly, [], from);
        const ov = { from, until };
        assert.equal(openStatus(weekly, true, at('2026-11-02T23:30:00'), [], ov).isOpen, true);       // open by hand
        assert.equal(openStatus(weekly, true, at('2026-11-02T23:30:00'), [], null).isOpen, false);    // without it the hours say closed
        assert.equal(openStatus(weekly, true, at('2026-11-03T09:00:00'), [], ov).isOpen, true);       // still the night
        assert.equal(openStatus(weekly, true, new Date(until.getTime() + 1000), [], ov).isOpen, true);   // it is opening time anyway
        assert.equal(openStatus(weekly, true, at('2026-11-03T23:30:00'), [], ov).isOpen, false);      // the next night: the hours rule again
        assert.equal(openStatus(weekly, false, at('2026-11-02T23:30:00'), [], ov).reason, 'paused');  // a pause by hand wins
    });
    test('the config shows the opening by hand only while it holds, and what the hours alone say', () => {
        const now = Date.now();
        const hours = (open, close) => { const d = [{ open, close }]; return { mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d }; };
        const closedNow = (() => {   // a window that is certainly not now: the hour that started 3 hours ago, for 1 hour (India time)
            const ist = new Date(now + 330 * 60000);
            const h = (ist.getUTCHours() + 21) % 24;
            const p = (n) => String(n).padStart(2, '0');
            return hours(`${p(h)}:00`, `${p((h + 1) % 24)}:00`);
        })();
        const tenant = (override) => ({ name: 'T', slug: 't', settings: { hours: { weekly: closedNow }, orders: override ? { hoursOverride: override } : {} } });
        const plain = resolveConfig(tenant(null));
        assert.equal(plain.restaurant.isOpen, false);
        assert.equal(plain.restaurant.hoursOpen, false);
        assert.equal(plain.restaurant.forcedOpenUntil, null);
        const forced = resolveConfig(tenant({ from: new Date(now - 60000), until: new Date(now + 3600000) }));
        assert.equal(forced.restaurant.isOpen, true);
        assert.equal(forced.restaurant.hoursOpen, false);
        assert.ok(forced.restaurant.forcedOpenUntil);
        const old = resolveConfig(tenant({ from: new Date(now - 7200000), until: new Date(now - 3600000) }));
        assert.equal(old.restaurant.isOpen, false);   // it ran out
        assert.equal(old.orders.hoursOverride, undefined);
    });
});
