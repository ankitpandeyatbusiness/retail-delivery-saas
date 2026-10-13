// SMS wallet. Integer paise only.
// Every change moves the balance AND writes the ledger row inside ONE database transaction,
// so a crash can never leave a top-up recorded but not added, or money taken with no ledger row.
// A repeated payment id hits the unique index, the transaction rolls back, and the answer is "duplicate".
//   const d = await debitForSms(tenantId, { purpose: 'otp' });  // before sending
//   if (!d.ok) -> stop (no balance)
//   send ... if the provider fails -> await refund(d.txnId)

const mongoose = require('mongoose');
const SmsWallet = require('../models/SmsWallet');
const SmsTransaction = require('../models/SmsTransaction');
const SmsLog = require('../models/SmsLog');
const PlatformSettings = require('../models/PlatformSettings');
const withTransaction = require('./withTransaction');
const smsConfig = require('./smsConfig');

// Temporary defaults. The platform settings replace these.
const DEFAULTS = { ratePerSmsPaise: 30, costPerSmsPaise: 20, lowBalancePaise: 5000 };

const isPaise = (n) => Number.isInteger(n) && n > 0;
const dupKey = (e) => e && e.code === 11000;
const bad = (status, message) => Object.assign(new Error(message), { status });

// Mock SMS does not touch the wallet, unless you turn this flag on for testing
const shouldCharge = () => process.env.SMS_MOCK !== 'true' || process.env.SMS_WALLET_IN_MOCK === 'true';

async function getWallet(tenantId) {
    const find = () => SmsWallet.findOne({ tenantId });
    let w = await find();
    if (w) return w;
    try {
        w = await SmsWallet.create({ tenantId });
    } catch (e) {
        if (!dupKey(e)) throw e;
        w = await find();          // another request made it a moment ago
    }
    return w;
}

const rateOf = (w) => w.ratePerSmsPaise ?? DEFAULTS.ratePerSmsPaise;
const costOf = (w) => w.costPerSmsPaise ?? DEFAULTS.costPerSmsPaise;
const lowOf = (w) => w.lowBalancePaise ?? DEFAULTS.lowBalancePaise;

// platform prices (cached 30 s) are copied into DEFAULTS, so a shop override still wins
let loadedAt = 0;
async function loadPlatform() {
    if (Date.now() - loadedAt < 30000) return;
    loadedAt = Date.now();
    const p = await PlatformSettings.findById('main').select('sms').lean().catch(() => null);
    for (const k of ['ratePerSmsPaise', 'costPerSmsPaise', 'lowBalancePaise']) {
        if (Number.isInteger(p?.sms?.[k])) DEFAULTS[k] = p.sms[k];
    }
}
const refreshPlatform = () => { loadedAt = 0; };

async function status(tenantId) {
    await loadPlatform();
    const w = await getWallet(tenantId);
    return {
        balancePaise: w.balancePaise,
        ratePerSmsPaise: rateOf(w),
        lowBalancePaise: lowOf(w),
        low: w.balancePaise < lowOf(w),
        zero: w.balancePaise < rateOf(w),
        blockAtZero: w.blockAtZero,
    };
}

// Takes the price of one SMS. { ok:false, reason:'no_balance' } when the wallet cannot pay.
async function debitForSms(tenantId, { purpose = 'otp', allowFree = false } = {}) {
    // the shop sends with its own DLT sender and pays its provider itself: no wallet, no price
    if (await smsConfig.usesOwn(tenantId, purpose)) return { ok: true, chargedPaise: 0, costPaise: 0, txnId: null, own: true };
    if (!shouldCharge()) return { ok: true, chargedPaise: 0, costPaise: 0, txnId: null, skipped: true };

    const w = await getWallet(tenantId);
    await loadPlatform();
    const rate = rateOf(w);

    return withTransaction(async (session) => {
        const after = await SmsWallet.findOneAndUpdate(
            { _id: w._id, balancePaise: { $gte: rate } },
            { $inc: { balancePaise: -rate } },
            { returnDocument: 'after', session },
        );
        if (!after) {
            if (!w.blockAtZero || allowFree) return { ok: true, chargedPaise: 0, costPaise: costOf(w), txnId: null, free: true };
            return { ok: false, reason: 'no_balance' };
        }
        const [txn] = await SmsTransaction.create([{
            tenantId, type: 'debit', amountPaise: -rate, balanceAfter: after.balancePaise,
            purpose, actor: { type: 'system', label: 'sms' },
        }], { session });
        return { ok: true, chargedPaise: rate, costPaise: costOf(w), txnId: txn._id, balanceAfter: after.balancePaise };
    });
}

// Gives the money back when the provider failed. Safe to call twice.
async function refund(txnId) {
    if (!txnId) return { ok: true, skipped: true };
    const debit = await SmsTransaction.findOne({ _id: txnId, type: 'debit' });
    if (!debit) return { ok: false, reason: 'not_found' };

    const amount = -debit.amountPaise;
    try {
        return await withTransaction(async (session) => {
            const after = await SmsWallet.findOneAndUpdate(
                { tenantId: debit.tenantId }, { $inc: { balancePaise: amount } }, { returnDocument: 'after', session },
            );
            if (!after) throw new Error('Wallet not found');
            await SmsTransaction.create([{
                tenantId: debit.tenantId, type: 'refund', amountPaise: amount, balanceAfter: after.balancePaise,
                paymentId: `refund:${debit._id}`, purpose: debit.purpose, note: 'SMS failed',
                actor: { type: 'system', label: 'sms' },
            }], { session });
            return { ok: true, balanceAfter: after.balancePaise };
        });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };   // already refunded, the balance was rolled back
        throw e;
    }
}

// Adds money: a paid top-up (with paymentId) or a manual credit by the superadmin.
async function credit({ tenantId, amountPaise, type = 'topup', paymentId, note, actor }) {
    if (!isPaise(amountPaise)) throw bad(400, 'Amount must be a whole number of paise above 0');
    if (!['topup', 'adjust'].includes(type)) throw bad(400, 'Invalid type');
    await getWallet(tenantId);

    try {
        return await withTransaction(async (session) => {
            const after = await SmsWallet.findOneAndUpdate(
                { tenantId }, { $inc: { balancePaise: amountPaise } }, { returnDocument: 'after', session },
            );
            const [txn] = await SmsTransaction.create([{
                tenantId, type, amountPaise, balanceAfter: after.balancePaise, paymentId, note, actor,
            }], { session });
            return { ok: true, balanceAfter: after.balancePaise, txnId: txn._id };
        });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };   // same payment came twice: nothing was added
        throw e;
    }
}

// Manual take-away by the superadmin. Cannot go below zero.
async function manualDebit({ tenantId, amountPaise, note, actor }) {
    if (!isPaise(amountPaise)) throw bad(400, 'Amount must be a whole number of paise above 0');
    const w = await getWallet(tenantId);

    return withTransaction(async (session) => {
        const after = await SmsWallet.findOneAndUpdate(
            { _id: w._id, balancePaise: { $gte: amountPaise } },
            { $inc: { balancePaise: -amountPaise } },
            { returnDocument: 'after', session },
        );
        if (!after) throw bad(400, 'Balance is lower than this amount');
        const [txn] = await SmsTransaction.create([{
            tenantId, type: 'adjust', amountPaise: -amountPaise, balanceAfter: after.balancePaise, note, actor,
        }], { session });
        return { ok: true, balanceAfter: after.balancePaise, txnId: txn._id };
    });
}

// Compares the balance with the sum of the ledger. differencePaise must be 0.
async function reconcileWallet(tenantId) {
    const id = new mongoose.Types.ObjectId(String(tenantId));
    const [w, rows] = await Promise.all([
        SmsWallet.findOne({ tenantId: id }).select('balancePaise').lean(),
        SmsTransaction.aggregate([{ $match: { tenantId: id } }, { $group: { _id: null, sum: { $sum: '$amountPaise' } } }]),
    ]);
    const balancePaise = w?.balancePaise || 0;
    const ledgerPaise = rows[0]?.sum || 0;
    return { balancePaise, ledgerPaise, differencePaise: balancePaise - ledgerPaise };
}

const mask = (phone) => {
    const p = String(phone || '');
    return p.length >= 6 ? `${p.slice(0, 2)}${'X'.repeat(p.length - 4)}${p.slice(-2)}` : 'XXXX';
};

async function logSms(args) {
    const row = await writeSmsLog(args);
    if (args.status === 'failed') require('./smsHealth').check().catch(() => {});   // 3 in 10 minutes = alert
    return row;
}

async function writeSmsLog({ tenantId, phone, purpose, debit, status, providerMessageId }) {
    return SmsLog.create({
        tenantId, phoneMasked: mask(phone), purpose, status, providerMessageId, own: !!debit?.own,

        chargedPaise: status === 'failed' ? 0 : debit?.chargedPaise || 0,
        costPaise: status === 'failed' ? 0 : debit?.costPaise || 0,
        txnId: debit?.txnId || undefined,
    });
}

module.exports = {
    DEFAULTS, refreshPlatform, shouldCharge, getWallet, status, debitForSms, refund, credit, manualDebit,
    reconcileWallet, logSms, mask, loadPlatform,
};