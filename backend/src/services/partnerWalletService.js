// The Partner plan's prepaid wallet. Integer paise only. Copied from the SMS wallet (smsWalletService.js): every change moves the balance AND writes
// the ledger row inside ONE database transaction, and unique keys make each step safe to repeat.
//
//   fee            Rs 3 to Rs 15 per COMPLETED order, from the order value at checkout (feeBase). Charged once per order, never refunded once taken.
//                  Cancelled or fully refunded orders are never completed, so they never pay. Undoing a completed order reverses its fee.
//   overdraft      a fee can push the balance a little below zero (platform setting, default Rs 100); the next top-up pays it back.
//                  NEW orders stop when the balance plus the overdraft is used up. Orders already taken and refunds always go on.
//   money          top-up in (with GST on top, see partnerTopup in platformCheckout), fees out. No cash-out, no transfer.
const mongoose = require('mongoose');
const PartnerWallet = require('../models/PartnerWallet');
const PartnerTransaction = require('../models/PartnerTransaction');
const Tenant = require('../models/Tenant');
const withTransaction = require('./withTransaction');
const planService = require('./planService');
const { httpError } = require('../middlewares/apiErrors');

const dupKey = (e) => e && e.code === 11000;
const isPaise = (n) => Number.isInteger(n) && n > 0;
const isPartner = (tenant) => tenant?.plan?.id === 'partner';

async function getWallet(tenantId) {
    const find = () => PartnerWallet.findOne({ tenantId });
    let w = await find();
    if (w) return w;
    try { w = await PartnerWallet.create({ tenantId }); } catch (e) { if (!dupKey(e)) throw e; w = await find(); }
    return w;
}

// the fee in whole rupees for an order value: the first slab whose "up to" is not below it (the last slab is open ended)
function feeRs(baseRs, slabs) {
    const v = Math.max(0, Number(baseRs) || 0);
    for (const s of slabs) if (s.upTo === null || v <= s.upTo) return s.feeRs;
    return slabs[slabs.length - 1].feeRs;
}

// the order value the fee is worked out from: fixed at checkout (items after coupon, before delivery charge and taxes); older orders fall back to the same sum
const baseOf = (order) => (Number.isFinite(order.partnerFeeBase) ? order.partnerFeeBase : Math.max(0, (order.pricing?.subtotal || 0) - (order.pricing?.discount || 0)));

async function slabsFor(tenant, defaults) {
    return tenant?.plan?.feeSlabsOverride || (defaults || await planService.getDefaults()).feeSlabs;
}

// Takes the fee of one completed order. Safe to call twice (the second call finds the fee row and does nothing).
// A table round earns/pays nothing until its bill is paid, the same rule as the points: the caller passes only settled orders.
async function chargeOrder(order) {
    const tenant = await Tenant.findById(order.tenantId).select('plan').lean();
    if (!isPartner(tenant)) return { skipped: 'not_partner' };
    if (process.env.PARTNER_FEES === 'off') return { skipped: 'kill_switch' };
    if (order.bulkId) return { skipped: 'bulk' };
    const defaults = await planService.getDefaults();
    const baseRs = baseOf(order);
    const fee = feeRs(baseRs, await slabsFor(tenant, defaults)) * 100;
    await getWallet(order.tenantId);
    try {
        return await withTransaction(async (session) => {
            const after = await PartnerWallet.findOneAndUpdate({ tenantId: order.tenantId }, { $inc: { balancePaise: -fee } }, { returnDocument: 'after', session });
            await PartnerTransaction.create([{
                tenantId: order.tenantId, type: 'fee', amountPaise: -fee, balanceAfter: after.balancePaise, orderId: order._id, orderNo: order.orderNo, baseRs,
                actor: { type: 'system', label: 'order completed' },
            }], { session });
            return { ok: true, feePaise: fee, balanceAfter: after.balancePaise };
        });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };   // the fee of this order was already taken
        throw e;
    }
}

// An order that was completed is undone (put back): its fee goes back too. Then completing it again takes the fee again (a new fee row is allowed once the old one is reversed).
async function reverseFee(orderId) {
    const fee = await PartnerTransaction.findOne({ orderId, type: 'fee' }).lean();
    if (!fee) return { skipped: 'no_fee' };
    const back = -fee.amountPaise;
    try {
        return await withTransaction(async (session) => {
            const after = await PartnerWallet.findOneAndUpdate({ tenantId: fee.tenantId }, { $inc: { balancePaise: back } }, { returnDocument: 'after', session });
            await PartnerTransaction.create([{
                tenantId: fee.tenantId, type: 'reverse', amountPaise: back, balanceAfter: after.balancePaise, orderId, orderNo: fee.orderNo, baseRs: fee.baseRs,
                note: 'Order put back', actor: { type: 'system', label: 'undo' },
            }], { session });
            // the fee row itself is turned into history so a re-completion can take a fresh one
            await PartnerTransaction.updateOne({ _id: fee._id }, { $set: { type: 'adjust', note: `Fee of order #${fee.orderNo} (reversed)` }, $unset: { orderId: 1 } }, { session });
            return { ok: true, balanceAfter: after.balancePaise };
        });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };
        throw e;
    }
}

// Adds money: a paid top-up (paymentId makes it safe to repeat) or a manual credit/adjust by the supreme admin.
async function credit({ tenantId, amountPaise, type = 'topup', paymentId, note, actor }) {
    if (!isPaise(amountPaise)) throw httpError(400, 'Amount must be a whole number of paise above 0');
    if (!['topup', 'adjust', 'plan_credit'].includes(type)) throw httpError(400, 'Invalid type');
    await getWallet(tenantId);
    try {
        return await withTransaction(async (session) => {
            const set = type === 'topup' ? { $inc: { balancePaise: amountPaise }, $set: { lastTopupPaise: amountPaise, lowAlertedAt: null, zeroAlertedAt: null } } : { $inc: { balancePaise: amountPaise } };
            const after = await PartnerWallet.findOneAndUpdate({ tenantId }, set, { returnDocument: 'after', session });
            const [txn] = await PartnerTransaction.create([{ tenantId, type, amountPaise, balanceAfter: after.balancePaise, paymentId, note, actor }], { session });
            return { ok: true, balanceAfter: after.balancePaise, txnId: txn._id };
        });
    } catch (e) {
        if (dupKey(e)) return { ok: true, duplicate: true };
        throw e;
    }
}

// Manual take-away by the supreme admin (a mistake, a chargeback). May go below zero: it is the admin's decision, written to the ledger with the reason.
async function manualDebit({ tenantId, amountPaise, note, actor }) {
    if (!isPaise(amountPaise)) throw httpError(400, 'Amount must be a whole number of paise above 0');
    await getWallet(tenantId);
    return withTransaction(async (session) => {
        const after = await PartnerWallet.findOneAndUpdate({ tenantId }, { $inc: { balancePaise: -amountPaise } }, { returnDocument: 'after', session });
        const [txn] = await PartnerTransaction.create([{ tenantId, type: 'adjust', amountPaise: -amountPaise, balanceAfter: after.balancePaise, note, actor }], { session });
        return { ok: true, balanceAfter: after.balancePaise, txnId: txn._id };
    });
}

// What the owner and the apps see
async function status(tenantId) {
    const [w, d] = await Promise.all([getWallet(tenantId), planService.getDefaults()]);
    const lowAt = Math.round(((w.lastTopupPaise || 0) * (d.walletLowPercent ?? 20)) / 100);
    const room = w.balancePaise + d.overdraftPaise;
    return {
        balancePaise: w.balancePaise, overdraftPaise: d.overdraftPaise,
        canTakeOrders: room > 0,
        zero: w.balancePaise <= 0,
        low: w.balancePaise > 0 && lowAt > 0 && w.balancePaise <= lowAt,
        lowAtPaise: lowAt,
        feeRange: { minRs: d.partner.feeMinRs, maxRs: d.partner.feeMaxRs },
    };
}

// New orders stop for a Partner shop whose wallet and overdraft are used up. Orders already taken, and refunds, are never touched by this.
async function assertCanTakeOrders(tenant) {
    if (!isPartner(tenant)) return;
    if (process.env.PARTNER_FEES === 'off') return;   // the kill switch: no fees and no stopping while it is off (see docs/plans-and-pricing.md)
    const s = await status(tenant._id);
    if (!s.canTakeOrders) throw httpError(409, 'This shop is not taking new orders right now.');
}

async function history(tenantId, { limit = 50 } = {}) {
    const rows = await PartnerTransaction.find({ tenantId }).sort({ createdAt: -1, _id: -1 }).limit(Math.min(limit, 200)).lean();
    const monthStart = new Date(); monthStart.setUTCHours(0, 0, 0, 0); monthStart.setUTCDate(1);
    const m = await PartnerTransaction.aggregate([{ $match: { tenantId: new mongoose.Types.ObjectId(String(tenantId)), type: 'fee', createdAt: { $gte: monthStart } } }, { $group: { _id: null, sum: { $sum: '$amountPaise' }, n: { $sum: 1 } } }]);
    return {
        items: rows.map((r) => ({ id: String(r._id), type: r.type, amountPaise: r.amountPaise, balanceAfter: r.balanceAfter, orderNo: r.orderNo || null, baseRs: r.baseRs ?? null, topupId: r.type === 'topup' && /^ptopup:[0-9a-f]{24}$/.test(r.paymentId || '') ? r.paymentId.slice(7) : null, note: r.note || '', at: r.createdAt })),
        feesThisMonth: { paise: -(m[0]?.sum || 0), orders: m[0]?.n || 0 },
    };
}

// The balance must equal the sum of the ledger. differencePaise must be 0.
async function reconcile(tenantId) {
    const id = new mongoose.Types.ObjectId(String(tenantId));
    const [w, rows] = await Promise.all([PartnerWallet.findOne({ tenantId: id }).select('balancePaise').lean(), PartnerTransaction.aggregate([{ $match: { tenantId: id } }, { $group: { _id: null, sum: { $sum: '$amountPaise' } } }])]);
    const balancePaise = w?.balancePaise || 0;
    const ledgerPaise = rows[0]?.sum || 0;
    return { balancePaise, ledgerPaise, differencePaise: balancePaise - ledgerPaise };
}

module.exports = { getWallet, feeRs, baseOf, chargeOrder, reverseFee, credit, manualDebit, status, assertCanTakeOrders, history, reconcile, isPartner };
