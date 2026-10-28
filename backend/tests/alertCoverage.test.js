require('./helpers/env');
// Every alert a person can receive has a group in their Alerts screen (so its notification, slider, sound and voice can be switched), with an English and a Hindi sample.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const alerts = require('../src/notifications/alertGroups');
const hi = require('../src/notifications/templates/textsHi');

test('the three alerts that had no switches now have their own group, with English and Hindi samples', () => {
    for (const [role, type, id] of [['waiter', 'waiter_paid', 'paid'], ['kitchen', 'kitchen_nudge', 'waiting'], ['kitchen', 'kitchen_late', 'waiting'], ['admin', 'table_guest_alert', 'guest_alert']]) {
        const g = alerts.groupOf(role, type);
        assert.equal(g?.id, id, `${role} ${type}`);
        assert.ok(g.sample.en && g.sample.hi, `${id}: an English and a Hindi sample`);
        assert.deepEqual(Object.keys(g.can).sort(), ['n', 'p', 's', 'v'], 'all four switches');
    }
    assert.ok(alerts.groupOf('waiter', 'waiter_paid').kinds.includes('paid'), 'the live alert of the waiter app follows the same switches');
});

test('"a guest who owes cannot be reached" starts quiet (it was a quiet alert); the person can switch the rest on', () => {
    const g = alerts.groupOf('admin', 'table_guest_alert');
    assert.deepEqual([g.defaults.n, g.defaults.p, g.defaults.s, g.defaults.v], [true, false, false, false]);
    assert.equal(alerts.prefOf({ guest_alert: { v: true } }, g).v, true);
    // the others keep everything on
    const paid = alerts.groupOf('waiter', 'waiter_paid');
    assert.deepEqual([paid.defaults.p, paid.defaults.s, paid.defaults.v], [true, true, true]);
});

test('the owner\'s guest alert has a Hindi sentence for the voice', () => {
    assert.match(hi.build('table_guest_alert', { table: 4, name: 'Anil', state: 'unreachable', amount: 120 }), /टेबल 4: Anil/);
});

test('the cook\'s waiting and late pushes carry what the voice says, in both languages', () => {
    const src = require('fs').readFileSync(require.resolve('../src/jobs/staffNudges.js'), 'utf8');
    for (const type of ['kitchen_nudge', 'kitchen_late']) {
        const line = src.split('\n').find((l) => l.includes(`type: '${type}'`));
        assert.ok(/speech: `/.test(line) && /speechHi: `/.test(line), type);
    }
});
