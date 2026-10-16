require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');
const Tenant = require('../src/models/Tenant');
const SuperAdmin = require('../src/models/SuperAdmin');
const LegalAcceptance = require('../src/models/LegalAcceptance');
const legal = require('../src/services/legal');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Terms, agreements and the privacy policy: the supreme admin edits and sends; everybody reads; owners, riders and the other
// superadmins are asked to agree on their SECOND visit after a version was sent (never the first), after the shop was handed over.
let w; let boss; let vivek;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });

const AUTH = (t) => ({ Authorization: `Bearer ${t.token}` });
const api = (m, url, who, body) => request(app)[m](`/api/admin${url}`).set(AUTH(who)).send(body);
const MIN = 60000;
const reload = async () => { tenantRecognizer.invalidateTenant('legal-shop'); return Tenant.findById(w.tenant._id).lean(); };
const asUser = (who) => ({ who: 'user', userId: who.user._id, role: who.user.role });
const send = (key, body = {}) => api('post', `/agreements/${key}/send`, boss, { summary: 'First version', ...body });

beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('legal-shop');
    tenantRecognizer.invalidateTenant('legal-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
    vivek = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });
    await PlatformSettings.findByIdAndUpdate('main', {
        $set: {
            'business.legalName': 'Operator Pvt Ltd', 'business.address': '1 Main Road, Lucknow', 'business.gstin': '09AAAAA0000A1Z5', 'business.appName': 'QuickBite',
            'business.contactPhone': '8318538918', 'business.poweredBy': 'Acme', 'settlement.ownerName': 'Ankit', 'settlement.partnerName': 'Vivek',
        },
    }, { upsert: true });
});

describe('the documents', () => {
    test('six documents start as drafts; everybody can read, only the supreme admin writes and sends', async () => {
        const list = await api('get', '/agreements', vivek);
        assert.equal(list.status, 200, JSON.stringify(list.body));
        assert.deepEqual(list.body.items.map((d) => d.key).sort(), ['customer_terms', 'operator_agreement', 'owner_terms', 'privacy', 'rider_terms', 'team_terms']);
        assert.ok(list.body.items.every((d) => d.currentVersion === 0));
        assert.equal((await api('put', '/agreements/owner_terms/draft', vivek, { title: 'x', body: 'y'.repeat(40) })).status, 403);
        assert.equal((await send('owner_terms').then(() => api('post', '/agreements/owner_terms/send', vivek, {}))).status, 403);
        assert.equal((await api('post', `/agreements/handover/${w.tenant._id}`, vivek, {})).status, 403);
        assert.equal((await api('put', `/legal/roles/${vivek.admin._id}`, vivek, { legalRole: 'partner' })).status, 403);
        assert.equal((await api('get', '/agreements/nope', boss)).status, 404);

        const draft = await api('put', '/agreements/owner_terms/draft', boss, { title: 'Owner terms', body: '# Terms\nBe fair to {{operatorName}}.\n- one' });
        assert.equal(draft.status, 200, JSON.stringify(draft.body));
        assert.equal(draft.body.draft.title, 'Owner terms');
        assert.equal((await api('put', '/agreements/owner_terms/draft', boss, { title: '', body: 'x'.repeat(40) })).status, 400);
    });

    test('sending freezes the text with the names filled in; blanks and missing company details stop it; old versions stay', async () => {
        const blocked = await send('operator_agreement');
        assert.equal(blocked.status, 400);
        assert.match(blocked.body.error, /blanks/i);
        const ok = await send('operator_agreement', { allowBlanks: true });
        assert.equal(ok.status, 201, JSON.stringify(ok.body));
        assert.equal(ok.body.currentVersion, 1);
        assert.match(ok.body.current.body, /Ankit/);
        assert.match(ok.body.current.body, /Operator Pvt Ltd/);
        assert.doesNotMatch(ok.body.current.body, /\{\{/);

        const v1 = (await send('owner_terms')).body;
        assert.equal(v1.currentVersion, 1);
        assert.match(v1.current.body, /Operator Pvt Ltd, 1 Main Road, Lucknow \(GSTIN 09AAAAA0000A1Z5\)/);
        await api('put', '/agreements/owner_terms/draft', boss, { title: 'Owner terms 2', body: '# New terms\nOnly this.\n- changed here' });
        const v2 = (await send('owner_terms', { summary: 'Short version' })).body;
        assert.equal(v2.currentVersion, 2);
        assert.equal(v2.versions.length, 2);
        const old = await api('get', '/agreements/owner_terms/versions/1', vivek);
        assert.match(old.body.body, /Terms of Service for shop owners/);
        assert.equal((await api('get', '/agreements/owner_terms/versions/9', vivek)).status, 404);

        await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { 'business.legalName': '' } });
        const noName = await send('team_terms');
        assert.equal(noName.status, 400);   // "[operator name]" would be a blank
    });
});

describe('the second visit', () => {
    test('an owner: nothing before the handover, never on the first visit, the screen on the second, gone after agreeing', async () => {
        await send('owner_terms');
        let t = await reload();
        const a = await legal.status({ ...asUser(w.owner), tenant: t });
        assert.deepEqual([a.required, a.waiting], [false, 'handover']);

        const mark = await api('post', `/agreements/handover/${w.tenant._id}`, boss, {});
        assert.equal(mark.status, 200);
        t = await reload();
        const t0 = new Date(Date.now() + MIN);
        const first = await legal.status({ ...asUser(w.owner), tenant: t, now: t0 });
        assert.deepEqual([first.required, first.visits], [false, 1]);
        const same = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 10 * MIN) });
        assert.deepEqual([same.required, same.visits], [false, 1]);               // the same sitting is not a new visit
        const second = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 45 * MIN) });
        assert.equal(second.required, true);
        assert.equal(second.version, 1);
        assert.match(second.body, /Operator Pvt Ltd/);

        const wrongVersion = await legal.accept({ ...asUser(w.owner), tenant: t, key: 'owner_terms', version: 1, name: 'Owner', phone: '9000000010' });
        assert.equal(wrongVersion.ok, true);
        await assert.rejects(legal.accept({ ...asUser(w.owner), tenant: t, key: 'rider_terms', version: 1 }), /not a document for you/);
        const done = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 200 * MIN) });
        assert.deepEqual([done.required, done.agreed], [false, true]);
        assert.equal(await LegalAcceptance.countDocuments({}), 1);
        await legal.accept({ ...asUser(w.owner), tenant: t, key: 'owner_terms', version: 1 });   // again: still one
        assert.equal(await LegalAcceptance.countDocuments({}), 1);

        // a new version starts the count again
        await api('put', '/agreements/owner_terms/draft', boss, { title: 'Owner terms', body: '# Terms\nA change.\n- more text here' });
        await send('owner_terms', { summary: 'A change' });
        const n1 = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 300 * MIN) });
        assert.deepEqual([n1.required, n1.visits], [false, 1]);
        const n2 = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 400 * MIN) });
        assert.deepEqual([n2.required, n2.version], [true, 2]);
    });

    test('through the app routes: the visit count, the agree call, and what each role can read', async () => {
        await send('owner_terms');
        await send('rider_terms');
        await api('post', `/agreements/handover/${w.tenant._id}`, boss, {});
        const get = (u, url) => request(app).get(`/api/legal${url}`).set(u.headers);
        const s1 = await get(w.owner, '/status');
        assert.equal(s1.status, 200, JSON.stringify(s1.body));
        assert.equal(s1.body.required, false);
        assert.equal((await get(w.customer, '/status')).body.required, false);          // customers never agree to anything
        assert.equal((await get(w.customer, '/doc/owner_terms')).status, 404);          // and cannot read an owner's terms
        assert.equal((await get(w.owner, '/doc/rider_terms')).status, 404);
        const mine = await get(w.owner, '/mine');
        assert.deepEqual(mine.body.items.map((d) => d.key).sort(), ['customer_terms', 'owner_terms', 'privacy']);
        assert.equal(mine.body.items.find((d) => d.key === 'owner_terms').mustAgree, true);
        assert.equal((await request(app).post('/api/legal/accept').set(w.owner.headers).send({ key: 'owner_terms', version: 9 })).status, 409);
        const ok = await request(app).post('/api/legal/accept').set(w.owner.headers).send({ key: 'owner_terms', version: 1 });
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await get(w.owner, '/mine')).body.items.find((d) => d.key === 'owner_terms').upToDate, true);
        assert.equal((await request(app).get('/api/legal/status')).status === 200, false);   // needs a login
    });

    test('a document sent as "ask when the free period ends" waits for the free period', async () => {
        await send('owner_terms', { askWhen: 'free_ends' });
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'billing.state': 'free' } });
        await api('post', `/agreements/handover/${w.tenant._id}`, boss, {});
        let t = await reload();
        const t0 = new Date(Date.now() + MIN);
        await legal.status({ ...asUser(w.owner), tenant: t, now: t0 });
        const second = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 60 * MIN) });
        assert.deepEqual([second.required, second.waiting], [false, 'free_period']);
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'billing.state': 'active' } });
        t = await reload();
        const third = await legal.status({ ...asUser(w.owner), tenant: t, now: new Date(t0.getTime() + 120 * MIN) });
        assert.equal(third.required, true);
    });

    test('a rider is asked the rider terms the same way', async () => {
        await send('rider_terms');
        await api('post', `/agreements/handover/${w.tenant._id}`, boss, {});
        const t = await reload();
        const t0 = new Date(Date.now() + MIN);
        await legal.status({ ...asUser(w.rider), tenant: t, now: t0 });
        const second = await legal.status({ ...asUser(w.rider), tenant: t, now: new Date(t0.getTime() + 40 * MIN) });
        assert.deepEqual([second.required, second.key], [true, 'rider_terms']);
    });
});

describe('the superadmins', () => {
    test('the partner gets the operating agreement, the others the team terms, the supreme admin neither', async () => {
        await send('operator_agreement', { allowBlanks: true });
        await send('team_terms');
        const t0 = new Date(Date.now() + MIN);
        const run = async (admin, now) => legal.status({ who: 'admin', userId: admin._id, admin: await SuperAdmin.findById(admin._id).lean(), now });

        assert.equal((await run(boss.admin, t0)).required, false);
        assert.equal((await run(boss.admin, new Date(t0.getTime() + 90 * MIN))).key, undefined);   // nothing for him
        await run(vivek.admin, t0);
        const team = await run(vivek.admin, new Date(t0.getTime() + 60 * MIN));
        assert.deepEqual([team.required, team.key], [true, 'team_terms']);

        const role = await api('put', `/legal/roles/${vivek.admin._id}`, boss, { legalRole: 'partner' });
        assert.equal(role.status, 200, JSON.stringify(role.body));
        assert.equal((await api('put', `/legal/roles/${vivek.admin._id}`, boss, { legalRole: 'king' })).status, 400);
        const asPartner = await run(vivek.admin, new Date(t0.getTime() + 120 * MIN));
        assert.equal(asPartner.key, 'operator_agreement');
        const route = await api('get', '/legal/status', vivek);
        assert.equal(route.status, 200);
        assert.equal(route.body.key, 'operator_agreement');
        const acc = await api('post', '/legal/accept', vivek, { key: 'operator_agreement', version: 1 });
        assert.equal(acc.status, 200, JSON.stringify(acc.body));
        assert.equal((await api('post', '/legal/accept', vivek, { key: 'team_terms', version: 1 })).status, 400);
    });

    test('who agreed and who has not, and the numbers on the list', async () => {
        await send('owner_terms');
        await api('post', `/agreements/handover/${w.tenant._id}`, boss, {});
        let r = await api('get', '/agreements/owner_terms/acceptances', vivek);
        assert.equal(r.body.agreed.length, 0);
        assert.equal(r.body.waiting.length, 1);
        assert.equal(r.body.waiting[0].shop, w.tenant.name);
        await legal.accept({ ...asUser(w.owner), tenant: await reload(), key: 'owner_terms', version: 1, name: 'Owner One', phone: '9000000010' });
        r = await api('get', '/agreements/owner_terms/acceptances', vivek);
        assert.equal(r.body.agreed.length, 1);
        assert.equal(r.body.agreed[0].name, 'Owner One');
        assert.equal(r.body.waiting.length, 0);
        const list = await api('get', '/agreements', vivek);
        assert.deepEqual(list.body.items.find((d) => d.key === 'owner_terms').stats, { total: 1, agreed: 1, waiting: 0 });
    });
});

describe('what everybody can read', () => {
    test('the customer pages work without a login, as JSON and as web pages, even before anything was sent', async () => {
        const j = await request(app).get('/api/legal/public/privacy');
        assert.equal(j.status, 200, JSON.stringify(j.body));
        assert.equal(j.body.draft, true);
        assert.match(j.body.body, /QuickBite/);
        assert.equal((await request(app).get('/api/legal/public/owner_terms')).status, 404);
        const page = await request(app).get('/legal/privacy');
        assert.equal(page.status, 200);
        assert.match(page.headers['content-type'], /html/);
        assert.match(page.text, /<h2>/);
        assert.match(page.text, /Operator Pvt Ltd/);
        assert.equal((await request(app).get('/legal/nothing')).status, 404);

        await send('privacy', { summary: 'v1' });
        assert.equal((await request(app).get('/api/legal/public/privacy')).body.no, 1);
        const info = await request(app).get('/api/legal/info');
        assert.deepEqual(info.body, { poweredBy: 'Acme', contactPhone: '8318538918' });
    });
});
