require('./helpers/env');
process.env.SMS_WALLET_IN_MOCK = 'true';   // make the wallet really charge, even in mock SMS mode
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const wallet = require('../src/services/smsWalletService');
const SmsWallet = require('../src/models/SmsWallet');
const SmsTransaction = require('../src/models/SmsTransaction');
const { makeTenant } = require('./helpers/factory');

const actor = { type: 'system', label: 'test' };
const newShop = async (slug) => { const t = await makeTenant(slug); await wallet.getWallet(t._id); return t; };
const balance = async (t) => (await SmsWallet.findOne({ tenantId: t._id })).balancePaise;
const topup = (t, amountPaise, paymentId) => wallet.credit({
    tenantId: t._id, amountPaise, type: paymentId ? 'topup' : 'adjust', paymentId, note: 'test', actor,
});

// makes the next ledger insert fail, like a crash between the two steps
async function withBrokenLedger(fn) {
    SmsTransaction.create = async () => { throw new Error('crash'); };
    try { await fn(); } finally { delete SmsTransaction.create; }
}

describe('SMS wallet', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('B4: a crash between ledger and balance leaves nothing half done, and a retry still credits', async () => {
        const t = await newShop('wallet-crash');
        await withBrokenLedger(() => assert.rejects(() => topup(t, 500, 'pay_crash'), /crash/));
        assert.equal(await balance(t), 0);                                     // balance was rolled back
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);

        const retry = await topup(t, 500, 'pay_crash');                        // the same payment id again
        assert.equal(retry.duplicate, undefined);                              // NOT "duplicate": it really credits now
        assert.equal(await balance(t), 500);
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
    });

    test('B4: a crash during a debit takes no money', async () => {
        const t = await newShop('wallet-crash-debit');
        await topup(t, 300);
        await withBrokenLedger(() => assert.rejects(() => wallet.debitForSms(t._id), /crash/));
        assert.equal(await balance(t), 300);
        assert.equal(await SmsTransaction.countDocuments({ tenantId: t._id, type: 'debit' }), 0);
    });

    test('the same top-up payment id is credited only once', async () => {
        const t = await newShop('wallet-dup');
        assert.equal((await topup(t, 1000, 'pay_same')).ok, true);
        assert.equal((await topup(t, 1000, 'pay_same')).duplicate, true);
        assert.equal(await balance(t), 1000);
        assert.equal(await SmsTransaction.countDocuments({ tenantId: t._id, paymentId: 'pay_same' }), 1);
    });

    test('the balance never goes below zero when many SMS are sent at once', async () => {
        const t = await newShop('wallet-race');
        await topup(t, 300);   // price is 30 paise, so exactly 10 SMS
        const results = await Promise.all(Array.from({ length: 20 }, () => wallet.debitForSms(t._id, { purpose: 'otp' })));
        assert.equal(results.filter((r) => r.ok).length, 10);
        assert.equal(results.filter((r) => !r.ok && r.reason === 'no_balance').length, 10);
        assert.equal(await balance(t), 0);
        assert.equal(await SmsTransaction.countDocuments({ tenantId: t._id, type: 'debit' }), 10);
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
    });

    test('a refund is paid once, even if called twice', async () => {
        const t = await newShop('wallet-refund');
        await topup(t, 300);
        const d = await wallet.debitForSms(t._id);
        assert.equal(await balance(t), 270);
        assert.equal((await wallet.refund(d.txnId)).ok, true);
        assert.equal((await wallet.refund(d.txnId)).duplicate, true);
        assert.equal(await balance(t), 300);
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
    });

    test('a manual take-away cannot go below zero', async () => {
        const t = await newShop('wallet-manual');
        await topup(t, 100);
        await assert.rejects(
            () => wallet.manualDebit({ tenantId: t._id, amountPaise: 200, note: 'x', actor }),
            (e) => e.status === 400,
        );
        assert.equal(await balance(t), 100);
        await wallet.manualDebit({ tenantId: t._id, amountPaise: 100, note: 'x', actor });
        assert.equal(await balance(t), 0);
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
    });

    test('only whole paise above zero are accepted', async () => {
        const t = await newShop('wallet-whole');
        for (const bad of [10.5, 0, -5, '10', NaN]) {
            await assert.rejects(() => topup(t, bad), (e) => e.status === 400, `${String(bad)} should be refused`);
        }
        assert.equal(await balance(t), 0);
    });

    test('reconcile notices when the balance and the ledger disagree', async () => {
        const t = await newShop('wallet-drift');
        await topup(t, 500, 'pay_drift');
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
        await SmsWallet.updateOne({ tenantId: t._id }, { $inc: { balancePaise: 5 } });   // someone edited the database by hand
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 5);
    });
});