require('./helpers/env');
// Every alert a person can get has a switch on the Alerts screen, for every panel: owner, rider, cook, waiter and CUSTOMER.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const events = require('../src/notifications/events');
const groups = require('../src/notifications/alertGroups');

before(() => db.connect());
after(() => db.disconnect());

// alerts that are deliberately always on (a security notice)
const ALWAYS_ON = new Set(['owner_email_changed']);
const ROLE = { owner: 'admin', rider: 'rider', kitchen: 'kitchen', waiter: 'waiter', customer: 'customer' };

describe('alert switches cover every alert', () => {
    test('every phone alert of the customer has a group; the owner, rider, cook and waiter ones too', () => {
        const E = events.EVENTS || events.events || events;
        const missing = [];
        for (const [key, d] of Object.entries(E)) {
            if (!d || typeof d !== 'object' || !d.to || d.to === 'superadmin') continue;
            if (d.noPush === true && !(d.channels || []).includes('inapp')) continue;
            if (ALWAYS_ON.has(key)) continue;
            const role = ROLE[d.to] || d.to;
            const covered = groups.groupsFor(role).some((g) => g.types.includes(key) || (g.kinds || []).includes(key));
            // the leave answers and the cook's rating go to staff roles whatever `to` says: they are covered under the cook's and the waiter's groups
            const staffOk = ['staff_leave_decision', 'staff_leave_removed', 'food_rating_cook'].includes(key);
            if (!covered && !staffOk) missing.push(`${d.to}:${key}`);
        }
        assert.deepEqual(missing, []);
    });

    test('the planned-maintenance notice (a broadcast) has its own switches on the owner, cook, waiter and rider screens', () => {
        for (const role of ['admin', 'kitchen', 'waiter', 'rider']) {
            const g = groups.groupOf(role, 'broadcast');
            assert.ok(g, role + ' has no group for a maintenance notice');
            assert.equal(g.can.p && g.can.s && g.can.v, true, role + ' needs the slider, tone and voice switches');
        }
    });

    test('a customer has a notification and a tone for each kind, but no slider or voice', () => {
        const list = groups.view('customer', {});
        assert.ok(list.length >= 8);
        for (const g of list) {
            assert.equal(g.can.n, true);
            assert.equal(g.can.s, true);
            assert.equal(g.can.p, false, `${g.id} slider`);
            assert.equal(g.can.v, false, `${g.id} voice`);
        }
    });

    test('the owner, rider, cook and waiter groups keep all four switches', () => {
        for (const role of ['admin', 'rider', 'kitchen', 'waiter']) {
            for (const g of groups.view(role, {})) {
                assert.equal(g.can.s && g.can.v && g.can.p, true, `${role}.${g.id}`);
            }
        }
    });
});

describe('a customer changes his alerts from the Alerts screen', () => {
    let w;
    beforeEach(async () => { await db.clear(); w = await f.makeWorld('ag-' + Date.now().toString(36)); });
    test('the list comes with his groups, a change is kept, and recommended puts it back', async () => {
        const get = () => request(app).get('/api/me/alerts').set(w.customer.headers);
        const r = await get();
        assert.equal(r.status, 200);
        assert.equal(r.body.role, 'customer');
        assert.ok(r.body.groups.find((g) => g.id === 'offers'));
        const put = await request(app).put('/api/me/alerts').set(w.customer.headers).send({ prefs: { offers: { s: false } } });
        assert.equal(put.status, 200);
        assert.equal(put.body.groups.find((g) => g.id === 'offers').pref.s, false);
        const back = await request(app).put('/api/me/alerts').set(w.customer.headers).send({ reset: true });
        assert.equal(back.body.groups.find((g) => g.id === 'offers').pref.s, true);
    });
});
