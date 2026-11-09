require('./helpers/env');
const { describe, test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const emailAdapter = require('../src/services/adapters/email');
const emailQueue = require('../src/services/emailQueue');
const { runEmailWorker } = require('../src/jobs/emailWorker');
const registry = require('../src/notifications/templates/email');
const emailChannel = require('../src/notifications/channels/email');
const smsChannel = require('../src/notifications/channels/sms');
const center = require('../src/notifications/center');
const topups = require('../src/services/smsTopupService');
const EmailJob = require('../src/models/EmailJob');
const Notification = require('../src/models/Notification');
const User = require('../src/models/User');
const Tenant = require('../src/models/Tenant');
const PlatformSettings = require('../src/models/PlatformSettings');
const { makeWorld, waitFor, sleep } = require('./helpers/factory');

// sets environment values for one test and puts them back after (undefined = remove)
async function withEnv(vars, fn) {
    const old = {};
    for (const [k, v] of Object.entries(vars)) {
        old[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(old)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
}

const CTX = {
    brand: { name: 'Acme Eats', color: '#0a5c36', logoUrl: 'https://cdn.test/logo.png' },
    footer: { legalName: 'Acme Pvt Ltd', address: '1 Road, Lucknow', gstin: '22AAAAA0000A1Z5' },
    panelUrl: 'https://panel.test',
    support: { email: 'help@acme.test', phone: '9000000000' },
};
const INV = {
    invoiceNo: 'SUB/2026-27/0001', period: '2026-10', orderCount: 410, tierLabel: '306 to 1005 orders', total: 7080,
    dueDate: new Date(), graceEndsAt: new Date(), paidAt: new Date(), paymentMode: 'bank_transfer', paymentRef: 'UTR123',
    seller: { paymentInstructions: 'UPI: acme@upi' },
};
const SAMPLES = {
    sms_topup_receipt: { amountPaise: 20000, gstPercent: 18, gstPaise: 3600, payablePaise: 23600, balanceAfter: 25000, paidAt: new Date() },
    welcome: { name: 'Ravi', phoneMasked: '98XXXXXX10' },
    owner_email_changed: { newEmailMasked: 'n***@shop.test', when: new Date() },
    login_alert: { when: new Date(), device: 'Android phone', ip: '49.36.1.1', who: 'boss@acme.test' },
    policy_change: { kind: 'terms', summary: 'We changed the cancellation rules.', url: 'https://acme.test/terms', effectiveDate: new Date() },
    refund_decision: { orderNo: 1042, status: 'done', amountPaise: 25000, reason: 'The shop could not deliver.' },
    complaint_decision: { orderNo: 1042, resolution: 'refund_partial', refundPaise: 10000, ownerReply: 'Sorry about the missing item.' },
    broadcast: { title: 'Diwali offer', body: 'Flat 20% off.\n\nOrder today.', kind: 'promo', sender: 'Savera' },
    email_code: { code: '482913', minutes: 10, ownerName: 'Ravi' },
    monthly_report: { report: { range: { label: 'September 2026' }, totals: { revenue: 125000, orders: 80, avgOrder: 1562, placed: 90, cancelled: 10 }, change: { revenue: 12 }, customers: { unique: 50, newCount: 20, repeatPct: 40 }, food: { top: [{ name: 'Paneer Roll', quantity: 30 }], loved: [{ name: 'Paneer Roll', avg: 4.6 }] }, delivery: { best: { name: 'Raju', deliveries: 25 } }, value: { show: true, revenue: 125000, marketplaceCost: 31250, feeBilled: 1180 }, tips: [{ title: 'Try a coupon', detail: 'Coupons bring people back.' }], quote: 'Keep going.', milestones: ['100 orders reached'] } },
};

// no SMS on these tests: the mail is what we look at
const quietSms = () => mock.method(smsChannel, 'send', async () => ({ sent: false }));
const setOwnerEmail = (w, address = 'owner@shop.test') => User.updateOne({ _id: w.owner.user._id }, { $set: { email: address } });

describe('email adapter', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    afterEach(() => mock.restoreAll());

    test('mock mode sends nothing over the network', async () => {
        const spy = mock.method(globalThis, 'fetch', async () => { throw new Error('no network expected'); });
        const r = await withEnv({ EMAIL_MOCK: 'true' }, () => emailAdapter.send({ to: 'a@b.test', subject: 'Hi', html: '<p>x</p>' }));
        assert.equal(r.messageId, 'mock');
        assert.equal(spy.mock.calls.length, 0);
    });

    test('real mode sends the request Brevo expects', async () => {
        const spy = mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ messageId: '<abc@x>' }) }));
        const vars = { EMAIL_MOCK: 'false', BREVO_API_KEY: 'test-key', MAIL_FROM_EMAIL: 'mail@app.test', MAIL_FROM_NAME: 'Acme' };
        const r = await withEnv(vars, () => emailAdapter.send({
            to: 'a@b.test', subject: 'Hi', html: '<p>x</p>', text: 'x', attachments: [{ name: 'a.pdf', content: 'QUJD' }],
        }));
        assert.equal(r.messageId, '<abc@x>');
        const [url, opts] = spy.mock.calls[0].arguments;
        assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
        assert.equal(opts.method, 'POST');
        assert.equal(opts.headers['api-key'], 'test-key');
        const body = JSON.parse(opts.body);
        assert.deepEqual(body.sender, { name: 'Acme', email: 'mail@app.test' });
        assert.deepEqual(body.to, [{ email: 'a@b.test' }]);
        assert.equal(body.subject, 'Hi');
        assert.equal(body.htmlContent, '<p>x</p>');
        assert.deepEqual(body.attachment, [{ name: 'a.pdf', content: 'QUJD' }]);
    });

    test('a provider error is thrown with its status, so the queue can retry', async () => {
        mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) }));
        const vars = { EMAIL_MOCK: 'false', BREVO_API_KEY: 'bad', MAIL_FROM_EMAIL: 'mail@app.test' };
        await assert.rejects(
            () => withEnv(vars, () => emailAdapter.send({ to: 'a@b.test', subject: 'Hi', html: '<p>x</p>' })),
            (e) => e.status === 401 && /Key not found/.test(e.message),
        );
    });
});

describe('email templates', () => {
    test('every mail renders, with the brand, the legal footer and no broken values', () => {
        assert.deepEqual(Object.keys(SAMPLES).sort(), registry.keys().sort());   // no mail is left untested
        for (const key of registry.keys()) {
            const mail = registry.get(key).build({ shopName: 'Savera', ...SAMPLES[key], ctx: CTX });
            assert.ok(mail.subject && mail.subject.length <= 150, `${key}: subject`);
            assert.match(mail.html, /^<!doctype html>/, `${key}: doctype`);
            assert.ok(mail.html.includes('name="viewport"'), `${key}: mobile viewport`);
            assert.ok(mail.html.includes('role="presentation"'), `${key}: table layout`);
            assert.ok(mail.html.includes('#0a5c36'), `${key}: brand colour`);
            assert.ok(mail.html.includes('alt="Acme Eats"'), `${key}: logo`);
            assert.ok(mail.html.includes('Acme Pvt Ltd') && mail.html.includes('GSTIN: 22AAAAA0000A1Z5'), `${key}: footer`);
            for (const part of [mail.subject, mail.html, mail.text]) {
                assert.ok(!/undefined|NaN|\[object|>null</.test(part), `${key}: has a broken value`);
            }
            assert.ok(mail.text.length > 40 && mail.text.includes('Acme Pvt Ltd'), `${key}: plain text`);
        }
    });

    test('text from people is escaped, so it cannot inject HTML', () => {
        const mail = registry.get('welcome').build({ shopName: 'A&B "Cafe"', name: '<script>alert(1)</script>', ctx: CTX });
        assert.ok(!mail.html.includes('<script>'));
        assert.ok(mail.html.includes('&lt;script&gt;'));
        assert.ok(mail.html.includes('A&amp;B &quot;Cafe&quot;'));
    });

    test('only promotional mails carry the "stop promotional messages" note', () => {
        const promo = registry.get('broadcast').build({ ...SAMPLES.broadcast, ctx: CTX });
        const info = registry.get('broadcast').build({ ...SAMPLES.broadcast, kind: 'info', ctx: CTX });
        const bill = registry.get('welcome').build({ ...SAMPLES.welcome, ctx: CTX });
        assert.ok(promo.html.includes('switch off Promotions') && promo.text.includes('switch off Promotions'));
        assert.ok(!info.html.includes('switch off Promotions'));
        assert.ok(!bill.html.includes('switch off Promotions'));
    });
});

describe('email queue', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    afterEach(() => mock.restoreAll());

    const mk = (subject, priority) => emailQueue.enqueue({ to: 'a@b.test', subject, html: '<p>x</p>', priority, kind: 'test' });

    test('the most important mail goes first, and the daily limit is kept', async () => {
        await EmailJob.deleteMany({});
        await mk('low', 3); await mk('high', 1); await mk('mid', 2);
        const order = [];
        mock.method(emailAdapter, 'send', async (a) => { order.push(a.subject); return { messageId: 'x' }; });

        const first = await withEnv({ EMAIL_DAILY_LIMIT: '2' }, () => runEmailWorker({ now: new Date() }));
        assert.deepEqual(order, ['high', 'mid']);
        assert.equal(first.sent, 2);
        const again = await withEnv({ EMAIL_DAILY_LIMIT: '2' }, () => runEmailWorker({ now: new Date() }));
        assert.equal(again.sent, 0);                                                    // the limit for today is used up
        assert.equal(await EmailJob.countDocuments({ status: 'queued', subject: 'low' }), 1);

        await withEnv({ EMAIL_DAILY_LIMIT: '300' }, () => runEmailWorker({ now: new Date() }));
        assert.deepEqual(order, ['high', 'mid', 'low']);
    });

    test('a failed mail is tried again after 1 minute, then 5 minutes, then marked failed', async () => {
        await EmailJob.deleteMany({});
        const job = await mk('retry me', 2);
        mock.method(emailAdapter, 'send', async () => { throw new Error('boom'); });
        const at = (minutes) => new Date(t0.getTime() + minutes * 60000);
        const t0 = new Date();
        const state = async () => EmailJob.findById(job._id).lean();

        await runEmailWorker({ now: t0 });
        assert.equal((await state()).tries, 1);
        await runEmailWorker({ now: at(0.5) });          // too early
        assert.equal((await state()).tries, 1);
        await runEmailWorker({ now: at(2) });
        assert.equal((await state()).tries, 2);
        await runEmailWorker({ now: at(3) });            // too early again
        assert.equal((await state()).tries, 2);
        await runEmailWorker({ now: at(8) });
        const done = await state();
        assert.equal(done.tries, 3);
        assert.equal(done.status, 'failed');
        assert.equal(done.lastError, 'boom');
        await runEmailWorker({ now: at(30) });
        assert.equal((await state()).tries, 3);          // never again
    });

    test('with no provider set up, the worker leaves the queue alone', async () => {
        await EmailJob.deleteMany({});
        await mk('wait', 2);
        const r = await withEnv(
            { EMAIL_MOCK: 'false', BREVO_API_KEY: undefined, MAIL_FROM_EMAIL: undefined },
            () => runEmailWorker({ now: new Date() }),
        );
        assert.equal(r.sent, 0);
        assert.equal(await EmailJob.countDocuments({ status: 'queued' }), 1);
    });
});

describe('email channel', () => {
    before(() => db.connect());
    after(() => db.disconnect());
    afterEach(() => mock.restoreAll());

    test('a mail can go to a fixed address, for example the OLD email of an account', async () => {
        const w = await makeWorld('mail-old-address');
        await setOwnerEmail(w, 'new@shop.test');
        const r = await emailChannel.queue({
            def: { email: 'owner_email_changed' },
            ctx: { tenantId: w.tenant._id, emailTo: ['Old@Shop.test'], vars: { newEmailMasked: 'n***@shop.test', when: new Date() } },
        });
        assert.equal(r.queued, 1);
        const jobs = await EmailJob.find({ tenantId: w.tenant._id }).lean();
        assert.deepEqual(jobs.map((j) => j.to), ['old@shop.test']);
        assert.equal(jobs[0].priority, 1);
    });

    test('an SMS top-up sends the owner an in-app message and one receipt mail', async () => {
        const w = await makeWorld('mail-topup');
        await setOwnerEmail(w);
        const t = await topups.create({ tenantId: w.tenant._id, amountPaise: 20000, actor: { type: 'owner' } });
        await topups.complete({ topupId: t._id, tenantId: w.tenant._id, actor: { type: 'superadmin' } });
        assert.ok(await waitFor(async () => (await EmailJob.countDocuments({ tenantId: w.tenant._id, kind: 'sms_topup_receipt' })) === 1));
        const job = await EmailJob.findOne({ tenantId: w.tenant._id, kind: 'sms_topup_receipt' }).lean();
        assert.ok(job.html.includes('Rs 200.00'));
        assert.equal(await Notification.countDocuments({ tenantId: w.tenant._id, type: 'sms_topup_done' }), 1);

        await topups.complete({ topupId: t._id, tenantId: w.tenant._id, actor: { type: 'superadmin' } });   // a repeat
        await sleep(400);
        assert.equal(await EmailJob.countDocuments({ tenantId: w.tenant._id, kind: 'sms_topup_receipt' }), 1);
    });
});