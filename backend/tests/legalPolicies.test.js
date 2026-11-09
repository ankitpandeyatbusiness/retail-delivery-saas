// Terms, privacy policies and About Us: written in the server, public, filled with the operator's details, and nothing to agree to.
require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); });

const setBusiness = (extra = {}) => PlatformSettings.findByIdAndUpdate('main', {
    $set: {
        'business.legalName': 'Vivyaan Business Systems', 'business.address': '1157/9 Naya Nagar South, Sirwara Road, Sultanpur, 228001, Uttar Pradesh, India',
        'business.appName': 'Vivyaan', 'business.email': 'support@vivyaanbusinesssystems.com', 'business.contactPhone': '+91 91515 66767', ...extra,
    },
}, { upsert: true });

const KEYS = ['customer_terms', 'privacy', 'owner_terms', 'owner_privacy', 'rider_terms', 'rider_privacy', 'staff_terms', 'staff_privacy', 'about_us'];
const PAGES = { terms: 'Terms of Service', privacy: 'Privacy Policy', about: 'About Vivyaan', 'owner-terms': 'Terms of Service for Shop Owners', 'owner-privacy': 'Privacy Policy for Shop Owners', 'rider-terms': 'Terms for delivery riders', 'rider-privacy': 'Privacy Policy for Riders', 'staff-terms': 'Terms of Service for Kitchen Staff and Waiters', 'staff-privacy': 'Privacy Policy for Kitchen Staff and Waiters' };
const BLANK = /\{\{|\[[a-z][^\]]+\]/i;

describe('the documents in the apps (JSON)', () => {
    test('every document is public, filled in, and has no blanks', async () => {
        await setBusiness();
        for (const key of KEYS) {
            const r = await request(app).get(`/api/legal/public/${key}`);
            assert.equal(r.status, 200, key);
            assert.ok(r.body.title && r.body.body, key);
            assert.ok(!BLANK.test(r.body.body), `${key} has an unfilled name or a blank`);
        }
        assert.equal((await request(app).get('/api/legal/public/nothing')).status, 404);
    });

    test('the customer terms hold the refund, delivery and contact policies as sections', async () => {
        await setBusiness();
        const t = (await request(app).get('/api/legal/public/customer_terms')).body.body;
        for (const s of ['# 5. Cancellation and refund policy', '# 6. Shipping and delivery policy', '# 9. Contact us', '5 to 7 working days', 'same payment method', 'Razorpay',
            'Vivyaan Business Systems', '1157/9 Naya Nagar South', 'support@vivyaanbusinesssystems.com', '+91 91515 66767', '10:00 AM to 5:00 PM, Monday to Friday', 'By using the app you accept them']) assert.ok(t.includes(s), s);
        assert.ok(!/asked to agree|Agree"/.test(t));
    });

    test('the owner terms cover plans, prepaid wallet, Razorpay payment, no refunds, and contact', async () => {
        await setBusiness();
        const t = (await request(app).get('/api/legal/public/owner_terms')).body.body;
        for (const s of ['we do not charge late fees', 'through our payment partner Razorpay', '# 6. No refunds', 'All payments to the Operator are non-refundable', '5 to 7 working days', 'written agreement you sign', '+91 91515 66767']) assert.ok(t.includes(s), s);
        const p = (await request(app).get('/api/legal/public/owner_privacy')).body.body;
        assert.ok(p.includes('Razorpay') && p.includes('never your card number'));
        assert.ok(!/asked to agree|Agree"/.test(t + p));
    });

    test('with no operator saved, the blanks stay visible instead of disappearing', async () => {
        const t = (await request(app).get('/api/legal/public/customer_terms')).body.body;
        assert.match(t, /\[operator name\]/);
        assert.match(t, /\[support email\]/);
        assert.match(t, /\[support phone\]/);
    });

    test('/api/legal/info gives the names for the About Us page', async () => {
        await setBusiness();
        const r = await request(app).get('/api/legal/info');
        assert.equal(r.status, 200);
        assert.equal(r.body.platformName, 'Vivyaan');
        assert.equal(r.body.operatorName, 'Vivyaan Business Systems');
        assert.equal(r.body.email, 'support@vivyaanbusinesssystems.com');
    });
});

describe('the web pages', () => {
    test('every page is public HTML with the details and no blanks', async () => {
        await setBusiness();
        for (const [page, h] of Object.entries(PAGES)) {
            const r = await request(app).get(`/legal/${page}`);
            assert.equal(r.status, 200, page);
            assert.match(r.headers['content-type'], /html/);
            assert.ok(!BLANK.test(r.text), `${page} has an unfilled name or a blank`);
            assert.ok(r.text.includes(h), `${page} should show "${h}"`);
            assert.ok(!/Version \d|Draft/.test(r.text), `${page} still shows a version`);
        }
        assert.equal((await request(app).get('/legal/nothing')).status, 404);
    });
});

describe('the agreement system and the handover mark are gone', () => {
    test('there is no agree gate, no agreements editor and no handover endpoint', async () => {
        const w = await f.makeWorld('legal-gone');
        const { token } = await f.makeSuperAdmin('legal-gone@test.com');
        const as = { Authorization: `Bearer ${token}` };
        assert.equal((await request(app).get('/api/legal/status').set(w.owner.headers)).status, 404);
        assert.equal((await request(app).post('/api/legal/accept').set(w.owner.headers).send({ key: 'owner_terms', version: 1 })).status, 404);
        assert.equal((await request(app).get('/api/legal/mine').set(w.owner.headers)).status, 404);
        assert.equal((await request(app).get('/api/admin/agreements').set(as)).status, 404);
        assert.equal((await request(app).put('/api/admin/agreements/owner_terms/draft').set(as).send({ body: 'x' })).status, 404);
        assert.equal((await request(app).post(`/api/admin/agreements/handover/${w.tenant._id}`).set(as).send({ handedOver: true })).status, 404);
        assert.equal((await request(app).get('/api/admin/legal/status').set(as)).status, 404);
    });
});

describe('editing and publishing in the superadmin app', () => {
    const NEW_TEXT = (n) => `# Terms of Service\nEffective {{effectiveDate}}. Edited text number ${n}, written by the supreme admin for {{platformName}}.\n\n# Contact us\nCall us on {{contactPhone}}`;
    let sup; let plain;
    const asSup = () => ({ Authorization: `Bearer ${sup.token}` });
    const asPlain = () => ({ Authorization: `Bearer ${plain.token}` });
    const pub = (key = 'customer_terms') => request(app).get(`/api/legal/public/${key}`);
    const draft = (text, key = 'customer_terms') => request(app).put(`/api/admin/legal-pages/${key}/draft`).set(asSup()).send({ body: text });
    beforeEach(async () => { sup = await f.makeSuperAdmin('sup@test.com'); plain = await f.makeSuperAdmin('plain@test.com', { phones: [] }); await setBusiness(); });

    test('every superadmin can read the list; the draft starts as the text that is shown now', async () => {
        const l = await request(app).get('/api/admin/legal-pages').set(asPlain());
        assert.equal(l.status, 200);
        assert.deepEqual(l.body.items.map((x) => x.key).sort(), [...KEYS].sort());
        assert.ok(l.body.items.every((x) => x.currentNo === 0 && !x.hasDraft));
        const one = (await request(app).get('/api/admin/legal-pages/customer_terms').set(asPlain())).body;
        assert.equal(one.draft.changed, false);
        assert.ok(one.draft.body.includes('# 5. Cancellation and refund policy'));
        assert.ok(one.names.includes('platformName') && one.names.includes('contactEmail'));
    });

    test('only the supreme admin can change anything', async () => {
        assert.equal((await request(app).put('/api/admin/legal-pages/customer_terms/draft').set(asPlain()).send({ body: NEW_TEXT(1) })).status, 403);
        assert.equal((await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asPlain())).status, 403);
        assert.equal((await request(app).post('/api/admin/legal-pages/customer_terms/discard').set(asPlain())).status, 403);
        assert.equal((await request(app).post('/api/admin/legal-pages/customer_terms/restore/1').set(asPlain())).status, 403);
        assert.equal((await request(app).get('/api/admin/legal-pages/customer_terms')).status, 401);
    });

    test('a saved draft is private; publishing shows it everywhere at once, filled in, with nobody asked to agree', async () => {
        const before = (await pub()).body.body;
        assert.equal((await draft(NEW_TEXT(1))).status, 200);
        assert.equal((await pub()).body.body, before, 'the draft is not shown to anybody yet');
        assert.equal((await request(app).get('/legal/terms')).text.includes('Edited text number 1'), false);

        const r = await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup());
        assert.equal(r.status, 201);
        assert.equal(r.body.currentNo, 1);
        assert.equal(r.body.draft.changed, false, 'the draft is used up');
        const shown = (await pub()).body.body;
        assert.match(shown, /Edited text number 1, written by the supreme admin for Vivyaan\./);
        assert.match(shown, /Call us on \+91 91515 66767/);
        assert.match(shown, /Effective \d{1,2} \w+ \d{4}\./, 'the date of publishing is filled in');
        assert.ok(!/\{\{/.test(shown));
        assert.ok((await request(app).get('/legal/terms')).text.includes('Edited text number 1'), 'the web page too');
        assert.equal((await pub('privacy')).body.body.includes('Edited text'), false, 'other documents are not touched');
    });

    test('history: every published text is kept, newest first, and an old one can come back as the draft and be published again', async () => {
        await draft(NEW_TEXT(1)); await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup());
        await draft(NEW_TEXT(2)); await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup());
        assert.match((await pub()).body.body, /Edited text number 2/);
        const full = (await request(app).get('/api/admin/legal-pages/customer_terms').set(asPlain())).body;
        assert.deepEqual(full.versions.map((v) => v.no), [2, 1]);
        assert.equal(full.versions[0].publishedBy, 'Boss');
        assert.match((await request(app).get('/api/admin/legal-pages/customer_terms/versions/1').set(asPlain())).body.body, /number 1/);
        assert.equal((await request(app).get('/api/admin/legal-pages/customer_terms/versions/9').set(asPlain())).status, 404);

        const back = await request(app).post('/api/admin/legal-pages/customer_terms/restore/1').set(asSup());
        assert.equal(back.status, 200);
        assert.match(back.body.draft.body, /number 1/);
        assert.match((await pub()).body.body, /number 2/, 'restoring only makes a draft: nothing changes until Publish');
        const again = await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup());
        assert.equal(again.body.currentNo, 3);
        assert.match((await pub()).body.body, /number 1/);
        assert.deepEqual(again.body.versions.map((v) => v.no), [3, 2, 1]);
    });

    test('discard throws the draft away; publish with no draft, an unknown {{name}}, a short text or open blanks is refused', async () => {
        assert.equal((await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup())).status, 409);
        await draft(NEW_TEXT(1));
        assert.equal((await request(app).post('/api/admin/legal-pages/customer_terms/discard').set(asSup())).body.draft.changed, false);
        assert.equal((await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup())).status, 409);

        await draft('# Terms\nThis uses {{madeUpName}} which does not exist, and is long enough.');
        const bad = await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup());
        assert.equal(bad.status, 400);
        assert.match(bad.body.error, /madeUpName/);
        assert.equal((await draft('short')).status, 400);

        await PlatformSettings.updateOne({ _id: 'main' }, { $unset: { 'business.email': '' } });
        await draft(`${NEW_TEXT(3)}
Write to us at {{contactEmail}}`);
        const blank = await request(app).post('/api/admin/legal-pages/customer_terms/publish').set(asSup());
        assert.equal(blank.status, 400);
        assert.match(blank.body.error, /Fill in the blanks/);
        assert.equal((await pub()).body.body.includes('Edited text'), false, 'nothing was published');
    });

    test('an unknown document is a 404', async () => {
        assert.equal((await request(app).get('/api/admin/legal-pages/nothing').set(asSup())).status, 404);
        assert.equal((await request(app).put('/api/admin/legal-pages/nothing/draft').set(asSup()).send({ body: NEW_TEXT(1) })).status, 404);
    });
});
