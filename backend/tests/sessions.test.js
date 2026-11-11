require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const Session = require('../src/models/Session');
const authController = require('../src/controllers/authController');
const { makeWorld, makeUser } = require('./helpers/factory');

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const fakeReq = (headers = {}, ip = '203.0.113.9') => ({ headers, ip });
const signIn = async (user, tenant, headers, ip) => {
    const { accessToken } = await authController.issueSession(user, tenant, fakeReq(headers, ip), ip || '203.0.113.9');
    return { Authorization: `Bearer ${accessToken}`, 'x-tenant-slug': tenant.slug };
};
const list = (h) => request(app).get('/api/auth/sessions').set(h);

describe('where you are logged in', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('the list shows this device first, with web/app, device name and city, and never an IP address', async () => {
        const w = await makeWorld('sess-list');
        const web = await signIn(w.customer.user, w.tenant, {
            'user-agent': CHROME_WIN, 'x-client-platform': 'web', 'cf-ipcity': 'Lucknow', 'cf-region': 'Uttar Pradesh', 'cf-ipcountry': 'IN',
        });
        const app1 = await signIn(w.customer.user, w.tenant, { 'user-agent': 'okhttp/4.12.0', 'x-client-platform': 'android' });

        const r = await list(app1);                       // asked from the phone
        assert.equal(r.status, 200);
        const items = r.body.items;
        assert.ok(items.length >= 3, 'the test login from the factory plus the two new ones');
        assert.equal(items[0].current, true);
        assert.equal(items[0].device, 'Android app');
        const webRow = items.find((x) => x.platform === 'web');
        assert.equal(webRow.device, 'Chrome on Windows');
        assert.equal(webRow.city, 'Lucknow');
        assert.equal(webRow.region, 'Uttar Pradesh');
        assert.equal(webRow.country, 'IN');
        assert.ok(webRow.loggedInAt && webRow.lastActiveAt);
        assert.equal(items.filter((x) => x.current).length, 1);
        assert.ok(!JSON.stringify(r.body).includes('203.0.113.9'), 'no IP address in the answer');
        assert.ok(!JSON.stringify(r.body).includes('refreshTokenHash'));
        void web;
    });

    test('a local address shows as a local network, not a made-up city', async () => {
        const w = await makeWorld('sess-local');
        const h = await signIn(w.customer.user, w.tenant, { 'user-agent': CHROME_WIN, 'x-client-platform': 'web' }, '::1');
        const row = (await list(h)).body.items.find((x) => x.current);
        assert.equal(row.place, 'Local network');
        assert.equal(row.city, '');
    });

    test('Log out on one device ends that device at once and leaves the others', async () => {
        const w = await makeWorld('sess-revoke');
        const phone = await signIn(w.customer.user, w.tenant, { 'x-client-platform': 'android', 'user-agent': 'okhttp/4' });
        const laptop = await signIn(w.customer.user, w.tenant, { 'x-client-platform': 'web', 'user-agent': CHROME_WIN });

        const laptopRow = (await list(phone)).body.items.find((x) => x.platform === 'web');
        const del = await request(app).delete(`/api/auth/sessions/${laptopRow.id}`).set(phone);
        assert.equal(del.status, 200);
        assert.equal(del.body.wasCurrent, false);

        assert.equal((await list(laptop)).status, 401, 'the laptop is signed out immediately');
        assert.equal((await list(phone)).status, 200, 'the phone still works');
        assert.equal((await request(app).delete(`/api/auth/sessions/${laptopRow.id}`).set(phone)).status, 404, 'already gone');
    });

    test('nobody can see or end another person\'s session', async () => {
        const w = await makeWorld('sess-isolation');
        const other = await makeUser(w.tenant, 'customer', '9000000099');
        const theirs = await Session.findOne({ userId: other.user._id });

        const mineList = (await list(w.customer.headers)).body.items;
        assert.ok(!mineList.some((x) => x.id === String(theirs._id)));
        assert.equal((await request(app).delete(`/api/auth/sessions/${theirs._id}`).set(w.customer.headers)).status, 404);
        assert.equal((await list(other.headers)).status, 200, 'theirs is still alive');
        assert.equal((await request(app).delete('/api/auth/sessions/not-an-id').set(w.customer.headers)).status, 404);
        assert.equal((await request(app).get('/api/auth/sessions').set('x-tenant-slug', w.tenant.slug)).status, 401, 'a login is needed');
    });

    test('Log out all other devices keeps only this one', async () => {
        const w = await makeWorld('sess-others');
        const a = await signIn(w.owner.user, w.tenant, { 'x-client-platform': 'android', 'user-agent': 'okhttp/4' });
        const b = await signIn(w.owner.user, w.tenant, { 'x-client-platform': 'web', 'user-agent': CHROME_WIN });
        const c = await signIn(w.owner.user, w.tenant, { 'x-client-platform': 'web', 'user-agent': CHROME_WIN.replace('Windows NT 10.0', 'Macintosh; Intel Mac OS X 10_15') });

        const r = await request(app).post('/api/auth/sessions/logout-others').set(b);
        assert.equal(r.status, 200);
        assert.ok(r.body.ended >= 3, 'the factory login, a and c');
        assert.equal((await list(b)).status, 200);
        assert.equal((await list(a)).status, 401);
        assert.equal((await list(c)).status, 401);
        assert.equal((await list(b)).body.items.length, 1);
        // other people are untouched
        assert.equal((await list(w.customer.headers)).status, 200);
    });

    test('a rider keeps ONE phone and may also have ONE website: the website never signs the phone out', async () => {
        const w = await makeWorld('sess-rider');
        const rider = w.rider.user;
        const phone1 = await signIn(rider, w.tenant, { 'x-client-platform': 'android', 'user-agent': 'okhttp/4' });
        const web1 = await signIn(rider, w.tenant, { 'x-client-platform': 'web', 'user-agent': CHROME_WIN });
        assert.equal((await list(phone1)).status, 200, 'logging in on the website did not end the phone');
        assert.equal((await list(web1)).status, 200);

        const phone2 = await signIn(rider, w.tenant, { 'x-client-platform': 'ios', 'user-agent': 'CFNetwork' });   // a new phone replaces the old phone
        assert.equal((await list(phone1)).status, 401, 'the old phone is signed out');
        assert.equal((await list(web1)).status, 200, 'the website stays');
        assert.equal((await list(phone2)).status, 200);

        const web2 = await signIn(rider, w.tenant, { 'x-client-platform': 'web', 'user-agent': CHROME_WIN });   // a second website replaces the first website
        assert.equal((await list(web1)).status, 401);
        assert.equal((await list(web2)).status, 200);
        assert.equal((await list(phone2)).status, 200, 'and the phone stays');
    });

    test('an ordinary user may be signed in on up to five devices', async () => {
        const w = await makeWorld('sess-five');
        const heads = [];
        for (let i = 0; i < 6; i += 1) heads.push(await signIn(w.customer.user, w.tenant, { 'x-client-platform': 'web', 'user-agent': CHROME_WIN }));
        const alive = (await Promise.all(heads.map((h) => list(h)))).filter((r) => r.status === 200).length;
        assert.equal(alive, 5);
    });

    test('a session saved before the device name was kept still shows a name: this device is named from the request, the others from their saved browser string', async () => {
        const w = await makeWorld('sess-old');
        const here = await signIn(w.customer.user, w.tenant, { 'user-agent': CHROME_WIN, 'x-client-platform': 'web' });
        const other = await signIn(w.customer.user, w.tenant, { 'user-agent': 'okhttp/4.12.0', 'x-client-platform': 'android' });
        // make both look like sessions from before the name was kept: no name, no platform, only the browser string
        await Session.updateMany({ userId: w.customer.user._id }, { $unset: { deviceLabel: 1, platform: 1 } });
        const otherRow = await Session.findOne({ userAgent: 'okhttp/4.12.0', userId: w.customer.user._id });
        const r = await list(here).set('user-agent', CHROME_WIN);
        assert.equal(r.status, 200);
        const cur = r.body.items.find((x) => x.current);
        assert.equal(cur.device, 'Chrome on Windows');
        assert.equal(cur.platform, 'web');
        const old = r.body.items.find((x) => x.id === String(otherRow._id));
        assert.equal(old.device, 'Android app');
        assert.equal(old.platform, 'android');
        // the current one was saved with its name, so it keeps it
        const saved = await Session.findById(cur.id).lean();
        assert.equal(saved.deviceLabel, 'Chrome on Windows');
        void other;
    });

    test('a session with no name and no browser string is still listed (as an unknown device), not an error', async () => {
        const w = await makeWorld('sess-blank');
        const a = await signIn(w.customer.user, w.tenant, { 'x-client-platform': 'web' });
        const b = await signIn(w.customer.user, w.tenant, { 'x-client-platform': 'web' });
        await Session.updateMany({ userId: w.customer.user._id }, { $unset: { deviceLabel: 1, platform: 1, userAgent: 1 } });
        const r = await list(a);
        assert.equal(r.status, 200);
        assert.ok(r.body.items.find((x) => !x.current).device);
        void b;
    });
});
