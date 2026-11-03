require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { makeSuperAdmin } = require('./helpers/factory');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const DeviceToken = require('../src/models/DeviceToken');
const Notification = require('../src/models/Notification');
const SmsLog = require('../src/models/SmsLog');
const tokenService = require('../src/services/tokenService');
const brandNotify = require('../src/services/brandNotify');
const pushAdapter = require('../src/services/adapters/push');
const smsAdapter = require('../src/services/adapters/sms');
const pushChannel = require('../src/notifications/channels/push');
const smsChannel = require('../src/notifications/channels/sms');
const wallet = require('../src/services/smsWalletService');

const RAJU = '9855555555';
const MGR = '9866666666';
let supreme;
let sent;   // what the push adapter was asked to send
const post = (url, body) => request(app).post(url).set({ Authorization: `Bearer ${supreme}` }).send(body);

before(async () => { await db.connect(); });
after(() => db.disconnect());
beforeEach(async () => {
    await db.clear();
    brandNotify.forget();
    supreme = (await makeSuperAdmin('boss@example.com')).token;
    sent = [];
    mock.method(pushAdapter, 'send', async (a) => { sent.push(a); return { sent: a.tokens.length, invalidTokens: [] }; });
});
afterEach(() => mock.restoreAll());

async function sessionAt(tenantId, phone, lastUsedAt = new Date()) {
    const user = await User.findOne({ tenantId, phone });
    const sid = new mongoose.Types.ObjectId();
    const { accessToken } = tokenService.generateTokens({ userId: user._id, tenantId, sessionId: sid });
    await Session.create({ _id: sid, userId: user._id, tenantId, refreshTokenHash: 'x', lastUsedAt, expiresAt: new Date(Date.now() + 3600000) });
    brandNotify.forget();
    return accessToken;
}
const tokenOf = (slug, who) => `tok-${who}-${slug}-padding-padding-padding`;

// Savera: Delhi, Mumbai, Goa. Raju is the brand owner (owner of all three). Mumbai also has its own manager. Every one has a phone registered at the branch.
async function world() {
    const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 6 })).body.brand;
    const b = {};
    for (const c of ['delhi', 'mumbai', 'goa']) {
        const r = await post(`/api/admin/brands/${brand._id}/branches`, { name: `Savera ${c}`, slug: `savera-${c}`, city: c });
        b[c] = r.body.branch;
    }
    assert.equal((await post(`/api/admin/brands/${brand._id}/owners`, { phone: RAJU })).status, 201);
    assert.equal((await post(`/api/admin/tenants/${b.mumbai.id}/owners`, { phone: MGR })).status, 201);
    for (const c of ['delhi', 'mumbai', 'goa']) {
        const u = await User.findOne({ tenantId: b[c].id, phone: RAJU });
        await DeviceToken.create({ tenantId: b[c].id, userId: u._id, token: tokenOf(c, 'raju') });
    }
    const m = await User.findOne({ tenantId: b.mumbai.id, phone: MGR });
    await DeviceToken.create({ tenantId: b.mumbai.id, userId: m._id, token: tokenOf('mumbai', 'mgr') });
    return { brand, b };
}
const alert = (w, city, type = 'order_new') => pushChannel.send({ tenantId: w.b[city].id, title: 'New order', body: '#12 · ₹300', data: { type, speech: 'New order twelve' } });
const reached = () => sent.flatMap((s) => s.tokens);
const prefs = (token, body) => request(app).put('/api/brand/notify-prefs').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${token}`).send(body);

describe('which branch alerts reach a brand owner', () => {
    test('by default: only the branch his app is open on (and a branch manager is never affected)', async () => {
        const w = await world();
        // nobody has used the app yet: Raju hears no branch, the Mumbai manager hears Mumbai
        await alert(w, 'delhi');
        assert.deepEqual(reached(), []);
        sent.length = 0;
        await alert(w, 'mumbai');
        assert.deepEqual(reached(), [tokenOf('mumbai', 'mgr')]);

        // he opens the app in Delhi: Delhi alerts now reach him, Mumbai and Goa still do not
        await sessionAt(w.b.delhi.id, RAJU);
        sent.length = 0; await alert(w, 'delhi');
        assert.deepEqual(reached(), [tokenOf('delhi', 'raju')]);
        sent.length = 0; await alert(w, 'goa');
        assert.deepEqual(reached(), []);

        // he switches to Mumbai (a newer login there): now Mumbai, no longer Delhi
        await sessionAt(w.b.mumbai.id, RAJU, new Date(Date.now() + 5000));
        sent.length = 0; await alert(w, 'delhi');
        assert.deepEqual(reached(), []);
        sent.length = 0; await alert(w, 'mumbai');
        assert.deepEqual(reached().sort(), [tokenOf('mumbai', 'mgr'), tokenOf('mumbai', 'raju')].sort());
    });

    test('his own branch always notifies; a switch turns another branch on or off; the master switch turns all on', async () => {
        const w = await world();
        const token = await sessionAt(w.b.delhi.id, RAJU);
        await sessionAt(w.b.mumbai.id, RAJU, new Date(Date.now() + 5000));   // he is looking at Mumbai

        // "I manage Delhi myself": Delhi notifies even while Mumbai is open
        assert.equal((await prefs(token, { ownSlug: 'savera-delhi' })).status, 200);
        sent.length = 0; await alert(w, 'delhi');
        assert.deepEqual(reached(), [tokenOf('delhi', 'raju')]);

        // switch Goa on
        const r = await prefs(token, { branches: { 'savera-goa': true } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const goa = r.body.branches.find((x) => x.slug === 'savera-goa');
        assert.deepEqual([goa.explicit, goa.on], [true, true]);
        sent.length = 0; await alert(w, 'goa');
        assert.deepEqual(reached(), [tokenOf('goa', 'raju')]);

        // switch his own branch off: muted, even though it is his own
        await prefs(token, { branches: { 'savera-delhi': false } });
        sent.length = 0; await alert(w, 'delhi');
        assert.deepEqual(reached(), []);
        // null = back to the default (own branch notifies again)
        await prefs(token, { branches: { 'savera-delhi': null } });
        sent.length = 0; await alert(w, 'delhi');
        assert.deepEqual(reached(), [tokenOf('delhi', 'raju')]);

        // the master switch: every branch
        await prefs(token, { all: true, branches: { 'savera-goa': null } });
        for (const c of ['delhi', 'mumbai', 'goa']) { sent.length = 0; await alert(w, c); assert.ok(reached().includes(tokenOf(c, 'raju')), c); }
    });

    test('serious alerts come through from a muted branch; ordinary ones do not', async () => {
        const w = await world();
        await sessionAt(w.b.delhi.id, RAJU);
        for (const type of ['rider_sos', 'order_unaccepted_reminder', 'shop_paused', 'bill_overdue', 'bill_reminder']) {
            sent.length = 0; await alert(w, 'goa', type);
            assert.deepEqual(reached(), [tokenOf('goa', 'raju')], type);
        }
        sent.length = 0; await alert(w, 'goa', 'order_new');
        assert.deepEqual(reached(), []);
    });

    test('every alert of a brand owner names its branch, in the title and for the voice; a manager gets the plain alert', async () => {
        const w = await world();
        await sessionAt(w.b.mumbai.id, RAJU);
        await alert(w, 'mumbai');
        const raju = sent.find((s) => s.tokens.includes(tokenOf('mumbai', 'raju')));
        const mgr = sent.find((s) => s.tokens.includes(tokenOf('mumbai', 'mgr')));
        assert.equal(raju.title, 'Savera mumbai · New order');
        assert.equal(raju.data.branch, 'Savera mumbai');
        assert.equal(raju.data.speech, 'Savera mumbai. New order twelve');
        assert.equal(mgr.title, 'New order');
        assert.equal(mgr.data.branch, undefined);
    });

    test('the SMS that follows an unheard push does not go to a brand owner who muted the branch', async () => {
        const w = await world();
        process.env.SMS_WALLET_IN_MOCK = 'true';
        try {
            await sessionAt(w.b.delhi.id, RAJU);
            await wallet.credit({ tenantId: w.b.goa.id, amountPaise: 5000, type: 'adjust', actor: { type: 'system' } });
            const sms = mock.method(smsAdapter, 'send', async () => ({ providerMessageId: 'x' }));
            // Goa: Raju is its only owner and Goa is muted for him: nobody to text
            await smsChannel.send({ eventKey: 'order_new', ctx: { tenantId: w.b.goa.id, data: {}, vars: {} } });
            assert.equal(sms.mock.calls.length, 0);
            // Delhi is open for him: he is texted
            await smsChannel.send({ eventKey: 'order_new', ctx: { tenantId: w.b.delhi.id, data: {}, vars: {} } });
            assert.equal(sms.mock.calls.length, 1);
        } finally { delete process.env.SMS_WALLET_IN_MOCK; }
    });

    test('settings: the superadmin can name his own branch when appointing; bad input is refused; muting a branch nobody else runs warns', async () => {
        const brand = (await post('/api/admin/brands', { name: 'Savera', branchLimit: 6 })).body.brand;
        const d = (await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Delhi', slug: 'savera-delhi', city: 'Delhi' })).body.branch;
        await post(`/api/admin/brands/${brand._id}/branches`, { name: 'Savera Mumbai', slug: 'savera-mumbai', city: 'Mumbai' });
        assert.equal((await post(`/api/admin/brands/${brand._id}/owners`, { phone: RAJU, ownSlug: 'nowhere' })).status, 404);
        assert.equal((await post(`/api/admin/brands/${brand._id}/owners`, { phone: RAJU, ownSlug: 'savera-delhi' })).status, 201);
        const token = await sessionAt(d.id, RAJU);
        const v = (await request(app).get('/api/brand/notify-prefs').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${token}`)).body;
        assert.equal(v.ownSlug, 'savera-delhi');
        assert.equal(v.branches.find((b) => b.slug === 'savera-delhi').on, true);
        assert.equal(v.branches.find((b) => b.slug === 'savera-mumbai').on, false);

        assert.equal((await prefs(token, { all: 'yes' })).status, 400);
        assert.equal((await prefs(token, { branches: { nowhere: true } })).status, 404);
        assert.equal((await prefs(token, { branches: { 'savera-mumbai': 'maybe' } })).status, 400);
        const w = await prefs(token, { branches: { 'savera-mumbai': false } });
        assert.match(w.body.warnings[0], /Savera Mumbai has no other manager/);

        // a manager who is not a brand owner cannot read or change these
        await post(`/api/admin/tenants/${d.id}/owners`, { phone: '9877777777' });
        const mgr = await sessionAt(d.id, '9877777777');
        assert.equal((await prefs(mgr, { all: true })).status, 403);
    });

    test('the combined inbox: every branch, each row labelled; muted branches are marked silent; filter by branch', async () => {
        const w = await world();
        const token = await sessionAt(w.b.delhi.id, RAJU);
        const row = (city, type, title) => Notification.create({ tenantId: w.b[city].id, role: 'owner', type, title });
        await row('delhi', 'order_new', 'New order in Delhi');
        await row('mumbai', 'order_new', 'New order in Mumbai');
        await row('mumbai', 'rider_sos', 'SOS in Mumbai');
        const list = await request(app).get('/api/brand/notifications').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${token}`);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        const by = Object.fromEntries(list.body.items.map((i) => [i.title, i]));
        assert.equal(by['New order in Delhi'].branch.name, 'Savera delhi');
        assert.equal(by['New order in Delhi'].silent, false);   // Delhi is open for him
        assert.equal(by['New order in Mumbai'].silent, true);   // muted: listed, but it did not buzz
        assert.equal(by['SOS in Mumbai'].silent, false);        // serious: it came through
        const only = await request(app).get('/api/brand/notifications?branch=savera-mumbai').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${token}`);
        assert.equal(only.body.items.length, 2);
        assert.equal((await request(app).get('/api/brand/notifications?branch=nowhere').set('x-tenant-slug', 'savera-delhi').set('Authorization', `Bearer ${token}`)).status, 404);
    });
});
