require('./helpers/env');
process.env.SECRETS_KEY = process.env.SECRETS_KEY || require('crypto').randomBytes(32).toString('base64');   // keys are saved encrypted
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const PlatformSettings = require('../src/models/PlatformSettings');
const OperatorSwitch = require('../src/models/OperatorSwitch');
const SubscriptionInvoice = require('../src/models/SubscriptionInvoice');
const Broadcast = require('../src/models/Broadcast');
const SettlementEntry = require('../src/models/SettlementEntry');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// The companies that run the platform and the "Switch operator" button: profiles, locked prefix, checklist, the switch itself.
let w; let boss; let vivek;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });

const AUTH = (t) => ({ Authorization: `Bearer ${t.token}` });
const api = (m, url, who, body) => request(app)[m](`/api/admin${url}`).set(AUTH(who)).send(body);
const live = async () => (await PlatformSettings.collection.findOne({ _id: 'main' }));
const bill = async () => (await api('post', `/tenants/${w.tenant._id}/invoices/custom`, boss, { lineItems: [{ description: 'Fee', qty: 1, rate: 1000 }] })).body;

const AGENCY = {
    label: 'My agency',
    business: { legalName: 'My Agency', address: '9 Lake Road, Pune', gstin: '27AAAAA1111A1Z5', pan: 'AAAAA1111A', state: 'maharashtra', invoicePrefix: 'abc', poweredBy: 'MyAgency', contactPhone: '8318538918' },
    settlementMode: 'owner_only',
};

beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('op-shop');
    tenantRecognizer.invalidateTenant('op-shop');
    boss = await f.makeSuperAdmin('boss@example.com');
    vivek = await f.makeSuperAdmin('vivek@example.com', { phones: ['9876543210'] });
    // the company that is live now (the operator partner's)
    await api('put', '/platform/business', boss, { legalName: 'Partner Pvt Ltd', address: '1 Main Road, Lucknow', gstin: '09AAAAA0000A1Z5', pan: 'AAAAA0000A', state: 'Uttar Pradesh', poweredBy: 'Partner' });
    await api('put', '/platform/payments/keys', boss, { keyId: 'rzp_test_PARTNER1', keySecret: 'secret-of-the-partner' });
});

const setup = async () => {
    const first = await api('post', '/operators/from-live', boss, { label: 'Partner company' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await api('post', '/operators', boss, AGENCY);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    return { first: first.body, second: second.body };
};

describe('the profiles', () => {
    test('save the live company first, add the agency; everybody can look, only the supreme admin changes; no secret is ever shown', async () => {
        const { first, second } = await setup();
        const list = await api('get', '/operators', vivek);
        assert.equal(list.status, 200);
        assert.equal(list.body.items.length, 2);
        assert.equal(list.body.activeId, first._id);
        const a = list.body.items.find((x) => x.id === second._id);
        assert.deepEqual([a.business.state, a.business.stateCode, a.business.invoicePrefix, a.settlementMode, a.hasKeys], ['Maharashtra', '27', 'ABC', 'owner_only', false]);
        assert.equal(list.body.items.find((x) => x.id === first._id).hasKeys, true);
        assert.equal(JSON.stringify(list.body).includes('secret-of-the-partner'), false);
        assert.equal(JSON.stringify(list.body).includes('Enc'), false);

        assert.equal((await api('post', '/operators', vivek, AGENCY)).status, 403);
        assert.equal((await api('put', `/operators/${second._id}`, vivek, { label: 'x' })).status, 403);
        assert.equal((await api('post', `/operators/${second._id}/switch`, vivek, {})).status, 403);
        assert.equal((await api('delete', `/operators/${second._id}`, vivek)).status, 403);
        assert.equal((await api('get', '/operators/checklist', vivek)).status, 200);
    });

    test('what is typed is checked', async () => {
        for (const business of [{ gstin: 'bad' }, { pan: 'x' }, { state: 'Atlantis' }, { invoicePrefix: 'no spaces!' }, { stateCode: '9' }, { logoUrl: 'http://x' }]) {
            assert.equal((await api('post', '/operators', boss, { label: 'X', business })).status, 400, JSON.stringify(business));
        }
        assert.equal((await api('post', '/operators', boss, { label: '' })).status, 400);
        const { second } = await setup();
        for (const keys of [{ keyId: 'nope', keySecret: 'long-enough-secret' }, { keyId: 'rzp_test_AGENCY12', keySecret: 'short' }]) {
            assert.equal((await api('put', `/operators/${second._id}/keys`, boss, keys)).status, 400);
        }
    });
});

describe('one source of truth', () => {
    test('editing Business details or the Razorpay keys changes the active company too, so they never drift apart', async () => {
        const { first, second } = await setup();
        await api('put', '/platform/business', boss, { poweredBy: 'Changed Live', phone: '9998887776' });
        let list = (await api('get', '/operators', boss)).body;
        const a = list.items.find((x) => x.id === first._id);
        assert.equal(a.business.poweredBy, 'Changed Live');
        assert.equal(a.business.phone, '9998887776');
        assert.equal(a.business.legalName, 'Partner Pvt Ltd');
        await api('put', '/platform/payments/keys', boss, { keyId: 'rzp_test_PARTNER2', keySecret: 'new-secret-of-the-partner' });
        list = (await api('get', '/operators', boss)).body;
        assert.equal(list.items.find((x) => x.id === first._id).keyId, 'rzp_test_PARTNER2');
        // a company that is not active is untouched by Business details
        await api('put', '/platform/business', boss, { poweredBy: 'Again' });
        list = (await api('get', '/operators', boss)).body;
        assert.equal(list.items.find((x) => x.id === second._id).business.poweredBy, 'MyAgency');
    });
});

describe('the switch', () => {
    test('the checklist says what is missing; the switch is refused until the keys are saved', async () => {
        const { second } = await setup();
        const c = await api('get', `/operators/checklist?to=${second._id}`, boss);
        assert.equal(c.status, 200, JSON.stringify(c.body));
        assert.equal(c.body.canSwitch, false);
        assert.equal(c.body.items.find((i) => i.id === 'keys').ok, false);
        assert.equal(c.body.items.find((i) => i.id === 'prefix').ok, true);
        const refused = await api('post', `/operators/${second._id}/switch`, boss, {});
        assert.equal(refused.status, 409);
        assert.match(refused.body.error, /Razorpay keys/);
        const noWay = await api('post', `/operators/${(await api('get', '/operators', boss)).body.activeId}/switch`, boss, {});
        assert.equal(noWay.status, 409);
        assert.match(noWay.body.error, /already the active/);
    });

    test('switching changes the business, the keys and the invoice numbering; old bills stay; the shops are told; it is written down', async () => {
        const { first, second } = await setup();
        const oldBill = await bill();
        assert.match(oldBill.invoiceNo, /^SUB\/\d{4}-\d{2}\/0001$/);
        assert.equal(oldBill.seller.legalName, 'Partner Pvt Ltd');

        assert.equal((await api('put', `/operators/${second._id}/keys`, boss, { keyId: 'rzp_test_AGENCY12', keySecret: 'secret-of-the-agency' })).status, 200);
        const sw = await api('post', `/operators/${second._id}/switch`, boss, { note: 'Year one is over' });
        assert.equal(sw.status, 200, JSON.stringify(sw.body));
        assert.deepEqual([sw.body.from, sw.body.to, sw.body.noticeSent], ['Partner company', 'My agency', true]);

        const l = await live();
        assert.equal(l.business.legalName, 'My Agency');
        assert.equal(l.business.gstin, '27AAAAA1111A1Z5');
        assert.equal(l.business.invoicePrefix, 'ABC');
        assert.equal(l.payments.keyId, 'rzp_test_AGENCY12');
        assert.equal(l.settlement.mode, 'owner_only');
        assert.equal(String(l.activeOperatorId), second._id);
        assert.equal(l.payments.verifiedAt, undefined);   // the new account must be tested

        const newBill = await bill();
        assert.match(newBill.invoiceNo, /^SUB\/ABC\/\d{4}-\d{2}\/0001$/);
        assert.equal(newBill.seller.legalName, 'My Agency');
        assert.equal(newBill.seller.pan, 'AAAAA1111A');
        const untouched = await SubscriptionInvoice.findById(oldBill._id).lean();
        assert.equal(untouched.seller.legalName, 'Partner Pvt Ltd');
        assert.equal(untouched.invoiceNo, oldBill.invoiceNo);

        // after the switch a payment is all the owner's
        await api('patch', `/subscriptions/invoices/${newBill._id}/status`, boss, { status: 'paid', paymentMode: 'upi' });
        await f.waitFor(async () => (await SettlementEntry.countDocuments({ invoiceId: newBill._id })) === 1);
        const row = await SettlementEntry.findOne({ invoiceId: newBill._id }).lean();
        assert.deepEqual([row.ownerShare, row.partnerShare, row.owes, row.status], [1000, 0, null, 'paid']);

        const rec = await OperatorSwitch.findOne({}).lean();
        assert.deepEqual([rec.fromLabel, rec.toLabel, rec.by, rec.note], ['Partner company', 'My agency', 'Boss', 'Year one is over']);
        assert.equal(await Broadcast.countDocuments({ audience: 'owners' }), 1);
        const note = await Broadcast.findOne({ audience: 'owners' }).lean();
        assert.match(note.title, /My Agency/);
        const hist = await api('get', '/operators', vivek);
        assert.equal(hist.body.activeId, second._id);
        assert.equal(hist.body.history.length, 1);
        assert.notEqual(hist.body.activeId, first._id);
    });

    test('the prefix locks once a bill with it exists; the active company cannot be deleted; a switch can skip the notice', async () => {
        const { first, second } = await setup();
        await api('put', `/operators/${second._id}/keys`, boss, { keyId: 'rzp_test_AGENCY12', keySecret: 'secret-of-the-agency' });
        assert.equal((await api('put', `/operators/${second._id}`, boss, { business: { invoicePrefix: 'XYZ' } })).status, 200);   // nothing issued yet
        await api('post', `/operators/${second._id}/switch`, boss, { notify: false });
        assert.equal(await Broadcast.countDocuments({}), 0);
        await bill();
        const locked = await api('put', `/operators/${second._id}`, boss, { business: { invoicePrefix: 'NEW' } });
        assert.equal(locked.status, 409);
        assert.match(locked.body.error, /locked/);
        assert.equal((await api('get', '/operators', boss)).body.items.find((x) => x.id === second._id).prefixLocked, true);
        assert.equal((await api('delete', `/operators/${second._id}`, boss)).status, 409);
        assert.equal((await api('delete', `/operators/${first._id}`, boss)).status, 200);

        // changing the live company's other details also changes what is live
        await api('put', `/operators/${second._id}`, boss, { business: { poweredBy: 'Brand Two' } });
        assert.equal((await live()).business.poweredBy, 'Brand Two');
    });
});
