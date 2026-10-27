require('./helpers/env');
// "Finished eating, nobody asked for the bill" starts WITHOUT the voice (the guests at the table must not hear it); the slider and the notification still come.
// When the guest asked for the bill himself and nobody came, the reminder keeps its voice as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const alerts = require('../src/notifications/alertGroups');

test('the owner: "finished eating" is silent by default; "asked for the bill" keeps its voice', () => {
    const g = alerts.groupOf('admin', 'table_check');
    assert.equal(g.id, 'bill_reminders');
    assert.equal(g.defaults.v, false);
    assert.equal(g.defaults.n, true);
    assert.equal(g.defaults.p, true);
    assert.equal(alerts.prefOf({}, g).v, false);
    for (const type of ['table_bill_asked', 'table_bill_waiting']) assert.equal(alerts.prefOf({}, alerts.groupOf('admin', type)).v, true, type);
});

test('the waiter: "finished eating" is its own alert, silent by default; a guest asking for the bill (and the reminder after it) keep the voice', () => {
    const g = alerts.groupOf('waiter', 'waiter_bill_reminder');
    assert.equal(g.id, 'bill_reminder');
    assert.ok(g.kinds.includes('bill_reminder'));
    assert.equal(alerts.prefOf({}, g).v, false);
    assert.equal(alerts.prefOf({}, alerts.groupOf('waiter', 'waiter_bill')).v, true);
});

test('a person can still switch the voice on, and only that difference is stored', () => {
    const g = alerts.groupOf('admin', 'table_check');
    assert.equal(alerts.prefOf({ bill_reminders: { v: true } }, g).v, true);
    assert.deepEqual(alerts.cleanPrefs('admin', { bill_reminders: { v: true } }), { bill_reminders: { v: true } });
    assert.deepEqual(alerts.cleanPrefs('admin', { bill_reminders: { v: false } }), {}, 'false is the recommended value: nothing stored');
});
