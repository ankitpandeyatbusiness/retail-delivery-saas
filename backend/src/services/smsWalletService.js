// SMS wallet. Integer paise only. Every change writes a ledger row first (unique paymentId = safe to repeat),
// then moves the balance with an atomic update.
//   const d = await debitForSms(tenantId, { purpose: 'otp' });  // before sending
//   if (!d.ok) -> stop (no balance)
//   send ... if the provider fails -> await refund(d.txnId)

const SmsWallet = require('../models/SmsWallet');
const SmsTransaction = require('../models/SmsTransaction');
const SmsLog = require('../models/SmsLog');
const PlatformSettings = require('../models/PlatformSettings');

// Temporary defaults. The platform settings batch replaces these.
const DEFAULTS = { ratePerSmsPaise: 30, costPerSmsPaise: 20, lowBalancePaise: 5000 };

const isPaise = (n) => Number.isInteger(n) && n > 0;
const dupKey = (e) => e && e.code === 11000;

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
    if (!shouldCharge()) return { ok: true, chargedPaise: 0, costPaise: 0, txnId: null, skipped: true };

    const w = await getWallet(tenantId);
    await loadPlatform();
    const rate = rateOf(w);
    const after = await SmsWallet.findOneAndUpdate(
        { _id: w._id, balancePaise: { $gte: rate } },
        { $inc: { balancePaise: -rate } },
        { new: true },
    );
    if (!after) {
        if (!w.blockAtZero || allowFree) return { ok: true, chargedPaise: 0, costPaise: costOf(w), txnId: null, free: true };
        return { ok: false, reason: 'no_balance' };
    }
    const txn = await SmsTransaction.create({
        tenantId, type: 'debit', amountPaise: -rate, balanceAfter: after.balancePaise,
        purpose, actor: { type: 'system', label: 'sms' },
    });
    return { ok: true, chargedPaise: rate, costPaise: costOf(w), txnId: txn._id, balanceAfter: after.balancePaise };
}

// Gives the money back when the provider failed. Safe to call twice.
async function refund(txnId) {
    if (!txnId) return { ok: true, skipped: true };
    const debit = await SmsTransaction.findOne({ _id: txnId, type: 'debit' });
    if (!debit) return { ok: false, reason: 'not_found' };

    const amount = -debit.amountPaise;
    let txn;
    try {
        txn = await SmsTransaction.create({
            tenantId: debit.tenantId, type: 'refund', amountPaise: amount,
            paymentId: `refund:${debit._id}`, purpose: debit.purpose, note: 'SMS failed',
            actor: { type: 'system', label: 'sms' },
        });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };
        throw e;
    }
    const after = await SmsWallet.findOneAndUpdate({ tenantId: debit.tenantId }, { $inc: { balancePaise: amount } }, { new: true });
    await SmsTransaction.updateOne({ _id: txn._id }, { $set: { balanceAfter: after.balancePaise } });
    return { ok: true, balanceAfter: after.balancePaise };
}

// Adds money: a paid top-up (with paymentId) or a manual credit by the superadmin.
async function credit({ tenantId, amountPaise, type = 'topup', paymentId, note, actor }) {
    if (!isPaise(amountPaise)) throw Object.assign(new Error('Amount must be a whole number of paise above 0'), { status: 400 });
    if (!['topup', 'adjust'].includes(type)) throw Object.assign(new Error('Invalid type'), { status: 400 });
    await getWallet(tenantId);

    let txn;
    try {
        txn = await SmsTransaction.create({ tenantId, type, amountPaise, paymentId, note, actor });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };     // same payment came twice
        throw e;
    }
    const after = await SmsWallet.findOneAndUpdate({ tenantId }, { $inc: { balancePaise: amountPaise } }, { new: true });
    await SmsTransaction.updateOne({ _id: txn._id }, { $set: { balanceAfter: after.balancePaise } });
    return { ok: true, balanceAfter: after.balancePaise, txnId: txn._id };
}

// Manual take-away by the superadmin. Cannot go below zero.
async function manualDebit({ tenantId, amountPaise, note, actor }) {
    if (!isPaise(amountPaise)) throw Object.assign(new Error('Amount must be a whole number of paise above 0'), { status: 400 });
    const w = await getWallet(tenantId);
    const after = await SmsWallet.findOneAndUpdate(
        { _id: w._id, balancePaise: { $gte: amountPaise } },
        { $inc: { balancePaise: -amountPaise } },
        { new: true },
    );
    if (!after) throw Object.assign(new Error('Balance is lower than this amount'), { status: 400 });
    const txn = await SmsTransaction.create({
        tenantId, type: 'adjust', amountPaise: -amountPaise, balanceAfter: after.balancePaise, note, actor,
    });
    return { ok: true, balanceAfter: after.balancePaise, txnId: txn._id };
}

const mask = (phone) => {
    const p = String(phone || '');
    return p.length >= 6 ? `${p.slice(0, 2)}${'X'.repeat(p.length - 4)}${p.slice(-2)}` : 'XXXX';
};

async function logSms({ tenantId, phone, purpose, debit, status, providerMessageId }) {
    return SmsLog.create({
        tenantId, phoneMasked: mask(phone), purpose, status, providerMessageId,
        chargedPaise: status === 'failed' ? 0 : debit?.chargedPaise || 0,
        costPaise: status === 'failed' ? 0 : debit?.costPaise || 0,
        txnId: debit?.txnId || undefined,
    });
}

module.exports = {
    DEFAULTS, refreshPlatform, shouldCharge, getWallet, status, debitForSms, refund, credit, manualDebit, logSms, mask,
};