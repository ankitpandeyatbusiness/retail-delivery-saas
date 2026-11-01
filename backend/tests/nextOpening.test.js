// "Until the next scheduled opening": the moment the shop is next open by its hours (owner, cook, waiter and rider off-duty choices).
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
const test = require('node:test');
const assert = require('node:assert');
const { nextOpening } = require('../src/services/tenantConfigService');

const every = (open, close) => Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open, close }]]));

test('open now: the opening after the next closing', () => {
    const at = new Date('2026-11-02T08:00:00Z');   // 1:30 PM India time, open 09:00-22:00
    assert.strictEqual(nextOpening(every('09:00', '22:00'), null, at).toISOString(), '2026-11-03T03:30:00.000Z');   // 9:00 AM tomorrow
});
test('closed now: the next opening', () => {
    const at = new Date('2026-11-02T20:00:00Z');   // 1:30 AM India time
    assert.strictEqual(nextOpening(every('09:00', '22:00'), null, at).toISOString(), '2026-11-03T03:30:00.000Z');
});
test('no opening hours and no holidays: nothing to follow', () => {
    assert.strictEqual(nextOpening({}, null, new Date()), null);
    assert.strictEqual(nextOpening(null, [], new Date()), null);
});
