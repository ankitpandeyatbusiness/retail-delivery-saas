// EMERGENCY refunds by the supreme admin: real money goes back to the shop's payment method (through the payment partner), for
//   plan      the unused part of a paid plan (or any amount up to what was paid), and the plan can be ended at once
//   wallet    the remaining balance of the Partner wallet, taken out of the wallet and returned against the top-ups it came from (GST included)
//   sms       the same for the SMS balance
// Rules: only what was actually paid online can go back (a free period, a credit or an admin adjustment is not cash); never more than was paid, counting earlier refunds;
// every request carries a request id so a double tap cannot refund twice; the wallet is emptied BEFORE the money is sent and put back if the partner refuses;
// a processed refund is a negative row in platformSales so the ledger, GST register and month close net it. Always needs a written reason.
const PlanPayment = require('../models/PlanPayment');
const PartnerTopup = require('../models/PartnerTopup');
const SmsTopup = require('../models/SmsTopup');
const PartnerWallet = require('../models/PartnerWallet');
const PartnerTransaction = require('../models/PartnerTransaction');
const SmsWallet = require('../models/SmsWallet');
const SmsTransaction = require('../models/SmsTransaction');
const PlatformRefund = require('../models/PlatformRefund');
const Tenant = require('../models/Tenant');
const withTransaction = require('./withTransaction');
const payments = require('./adapters/payments');
const partnerWallet = require('./partnerWalletService');
const smsWallet = require('./smsWalletService');
const PlatformSettings = require('../models/PlatformSettings');
const invoicing = require('./platformInvoicing');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const { httpError } = require('../middlewares/apiErrors');

const DAY = 86400000;
const MIN = 100;   // Rs 1: the smallest refund the payment partner takes

const refundedOf = async (kind, ids) => {
    const rows = await PlatformRefund.find({ kind, sourceId: { $in: ids.map(String) }, status: { $in: ['processed', 'pending'] } }).lean();
    const by = {};
    for (const r of rows) { const o = by[r.sourceId] || (by[r.sourceId] = { cash: 0, base: 0 }); o.cash += r.cashPaise; o.base += r.walletPaise || r.basePaise; }
    return by;
};

// --- what can be refunded, for the screen ---
async function overview(tenant, now = new Date()) {
    const plansRaw = await PlanPayment.find({ tenantId: tenant._id, status: { $in: ['paid', 'held'] }, paymentId: { $type: 'string' } }).sort({ createdAt: -1 }).limit(12).lean();
    const pBy = await refundedOf('plan', plansRaw.map((p) => p._id));
    const planEnd = tenant.plan?.endsAt ? new Date(tenant.plan.endsAt) : null;
    const plan = plansRaw.map((p) => {
        const done = pBy[String(p._id)]?.cash || 0;
        const left = Math.max(0, p.payablePaise - done);
        const q = p.quote || {};
        const current = !!(p.status === 'paid' && planEnd && q.endsAt && Math.abs(new Date(q.endsAt) - planEnd) < 1000 && planEnd > now);
        let suggested = p.status === 'held' ? left : 0;
        if (current && q.startsAt) {
            const total = Math.max(1, Math.ceil((new Date(q.endsAt) - new Date(q.startsAt)) / DAY));
            const remaining = Math.max(0, Math.ceil((planEnd - now) / DAY));
            suggested = Math.min(left, Math.floor((p.payablePaise * Math.min(remaining, total)) / total));
        }
        return { id: String(p._id), kind: p.kind, to: p.to, months: p.months, status: p.status, paidAt: p.paidAt, payablePaise: p.payablePaise, refundedPaise: done, refundablePaise: left, suggestedPaise: suggested, current };
    });
    const out = { plan, planEndsAt: planEnd };
    for (const [kind, Topup, getWallet] of [['wallet', PartnerTopup, partnerWallet.getWallet], ['sms', SmsTopup, smsWallet.getWallet]]) {
        const w = await getWallet(tenant._id);
        const tops = await Topup.find({ tenantId: tenant._id, status: 'paid', paymentId: { $type: 'string' } }).sort({ paidAt: -1 }).lean();
        const by = await refundedOf(kind, tops.map((t) => t._id));
        let room = 0; let cashRoom = 0;
        for (const t of tops) { const left = Math.max(0, t.amountPaise - (by[String(t._id)]?.base || 0)); room += left; cashRoom += Math.round((left * (t.payablePaise || t.amountPaise)) / t.amountPaise); }
        const balance = w?.balancePaise || 0;
        const base = Math.max(0, Math.min(balance, room));   // the balance that came from real top-ups
        out[kind] = { balancePaise: balance, refundableBasePaise: base, estimatedCashPaise: room ? Math.round((cashRoom * base) / room) : 0 };
    }
    out.history = (await PlatformRefund.find({ tenantId: tenant._id }).sort({ createdAt: -1 }).limit(30).lean())
        .map((r) => ({ id: String(r._id), kind: r.kind, cashPaise: r.cashPaise, status: r.status, reason: r.reason, by: r.by, at: r.createdAt, endedPlan: r.endedPlan, error: r.error || null, creditNoteNo: r.creditNote?.invoiceNo || null }));
    return out;
}

// The GST credit note of a SENT refund, made once (the number is taken only if it is saved). Nothing is made while the platform's business details are empty; it is made the next time it is asked for.
async function ensureCreditNote(refundId) {
    const r = await PlatformRefund.findById(refundId).lean();
    if (!r || r.status !== 'processed' || !r.counted) return null;
    if (r.creditNote && r.creditNote.invoiceNo) return r.creditNote;
    const platform = await PlatformSettings.findById('main').select('business').lean();
    if (!platform?.business?.legalName) return null;
    const tenant = await Tenant.findById(r.tenantId).select('name phone address business').lean();
    if (!tenant) return null;
    const Source = r.kind === 'plan' ? PlanPayment : r.kind === 'wallet' ? PartnerTopup : SmsTopup;
    const src = await Source.findById(r.sourceId).select('invoice').lean();
    const now = r.createdAt || new Date();
    const num = await invoicing.allocate('CN', { now });
    const { seller, buyer } = invoicing.parties(platform.business, tenant);
    const base = r.basePaise / 100; const gstAmount = r.gstPaise / 100;
    const label = r.kind === 'plan' ? 'Refund of a plan payment' : r.kind === 'wallet' ? 'Refund of wallet money' : 'Refund of SMS balance';
    const tax = invoicing.taxFor({ seller, buyer, gstAmount });
    const note = {
        invoiceNo: num.invoiceNo, kind: 'credit_note', issueDate: now, originalInvoiceNo: src?.invoice?.invoiceNo || null, originalIssueDate: src?.invoice?.issueDate || null,
        description: label, lineItems: [{ description: label, qty: 1, rate: base, amount: base }], baseAmount: base, gstPercent: r.basePaise ? Math.round((r.gstPaise / r.basePaise) * 100) : 0,
        gstAmount, total: r.cashPaise / 100, reason: r.reason, reverseCharge: false, ...tax, seller, buyer,
    };
    const u = await PlatformRefund.updateOne({ _id: r._id, 'creditNote.invoiceNo': { $exists: false } }, { $set: { creditNote: note } });
    if (!u.modifiedCount) { await num.undo(); return (await PlatformRefund.findById(r._id).select('creditNote').lean())?.creditNote || null; }
    return note;
}

const askPartner = async (paymentId, amountPaise, key, reason) => {
    const r = await payments.refund({ paymentId, amountPaise, notes: { purpose: 'emergency_refund', reason: String(reason).slice(0, 100) }, receipt: key.slice(0, 40) });
    return r;
};

// One refund at a time per shop: two admins (or two taps with different request ids) cannot both refund the same money. The lock frees itself after 2 minutes if a server dies.
async function withShopLock(tenantId, fn) {
    const now = new Date();
    const got = await Tenant.findOneAndUpdate({ _id: tenantId, $or: [{ refundLockAt: { $exists: false } }, { refundLockAt: null }, { refundLockAt: { $lt: new Date(now.getTime() - 120000) } }] }, { $set: { refundLockAt: now } }, { new: true }).select('_id').lean();
    if (!got) throw httpError(409, 'Another refund for this shop is running. Try again in a moment.');
    try { return await fn(); } finally { await Tenant.updateOne({ _id: tenantId }, { $unset: { refundLockAt: 1 } }); }
}

// --- a plan payment ---
async function refundPlanImpl({ tenant, sourceId, amountPaise, endPlan = true, reason, requestId, by }) {
    const key = `${requestId}:0`;
    const dup = await PlatformRefund.findOne({ key }).lean();
    if (dup) return { ok: true, duplicate: true, status: dup.status, cashPaise: dup.cashPaise };
    const p = /^[0-9a-f]{24}$/.test(String(sourceId)) ? await PlanPayment.findOne({ _id: sourceId, tenantId: tenant._id, status: { $in: ['paid', 'held'] } }).lean() : null;
    if (!p) throw httpError(404, 'Payment not found');
    if (!p.paymentId) throw httpError(409, 'This payment has no online money to send back');
    const done = (await refundedOf('plan', [p._id]))[String(p._id)]?.cash || 0;
    const left = p.payablePaise - done;
    if (!Number.isInteger(amountPaise) || amountPaise < MIN) throw httpError(400, 'The refund must be at least Rs 1');
    if (amountPaise > left) throw httpError(400, 'That is more than is left to refund on this payment');
    const q = p.quote || {};
    const gst = q.gstPaise && p.payablePaise ? Math.round((amountPaise * q.gstPaise) / p.payablePaise) : 0;
    const row = await PlatformRefund.create({
        tenantId: tenant._id, kind: 'plan', salesKind: p.kind === 'branch' ? 'branch' : 'plan', sourceId: String(p._id), paymentId: p.paymentId, cashPaise: amountPaise, basePaise: amountPaise - gst, gstPaise: gst,
        counted: p.status === 'paid', reason, by, key, endedPlan: !!endPlan && p.kind !== 'branch',
    });
    let r;
    try { r = await askPartner(p.paymentId, amountPaise, key, reason); } catch (e) {
        await PlatformRefund.updateOne({ _id: row._id }, { $set: { status: 'failed', error: String(e.message || e).slice(0, 200) } });
        throw httpError(409, 'The payment partner did not accept the refund. Nothing was changed.');
    }
    await PlatformRefund.updateOne({ _id: row._id }, { $set: { status: 'processed', refundId: r.refundId } });
    await ensureCreditNote(row._id).catch((e) => console.error('Credit note error:', e.message));
    if (endPlan && p.kind !== 'branch') await endPlanNow(tenant._id, tenant.slug);
    if (tenant.plan?.scheduled?.prepaid?.paymentId === String(p._id) && amountPaise + done >= p.payablePaise) {   // the plan paid in advance is refunded in full: it must not start later
        await Tenant.updateOne({ _id: tenant._id }, { $unset: { 'plan.scheduled': 1 } });
        invalidateTenant(tenant.slug);
    }
    return { ok: true, status: 'processed', cashPaise: amountPaise, refundId: r.refundId, endedPlan: !!endPlan && p.kind !== 'branch' };
}

// the plan stops now: the shop sees "choose your plan" (the reminders, grace and pause then follow the usual rules)
async function endPlanNow(tenantId, slug, now = new Date()) {
    const t = await Tenant.findById(tenantId).select('plan').lean();
    if (!t?.plan?.id) return;
    await Tenant.updateOne({ _id: tenantId }, { $set: { 'plan.endsAt': new Date(now.getTime() - 1000), 'plan.freeUntil': null }, $unset: { 'plan.scheduled': 1 }, $push: { 'plan.history': { at: now, by: 'refund', from: t.plan.id, to: t.plan.id, note: 'ended by an emergency refund' } } });
    invalidateTenant(slug);
}

// --- a wallet (Partner or SMS) ---
// amountPaise = the wallet money to give back (what the owner would otherwise keep); the cash that goes back is that plus its GST share, split over the top-ups newest first
async function refundWalletImpl({ tenant, kind, amountPaise, reason, requestId, by }) {
    const Topup = kind === 'wallet' ? PartnerTopup : SmsTopup;
    const first = await PlatformRefund.findOne({ key: `${requestId}:0` }).lean();
    if (first) return { ok: true, duplicate: true, status: first.status };
    if (!Number.isInteger(amountPaise) || amountPaise < MIN) throw httpError(400, 'The refund must be at least Rs 1');
    const tops = await Topup.find({ tenantId: tenant._id, status: 'paid', paymentId: { $type: 'string' } }).sort({ paidAt: -1 }).lean();
    const by_ = await refundedOf(kind, tops.map((t) => t._id));
    const parts = []; let need = amountPaise;
    for (const t of tops) {
        if (need <= 0) break;
        const room = t.amountPaise - (by_[String(t._id)]?.base || 0);
        if (room <= 0) continue;
        const base = Math.min(room, need);
        parts.push({ t, base, cash: Math.round((base * (t.payablePaise || t.amountPaise)) / t.amountPaise), gst: Math.round((base * (t.gstPaise || 0)) / t.amountPaise) });
        need -= base;
    }
    if (need > 0) throw httpError(400, 'That is more than the wallet money that was paid for online');
    if (parts.some((x) => x.cash < MIN)) throw httpError(400, 'One part of this refund is under Rs 1. Choose a larger amount.');
    // 1. the wallet gives the money up first (never below zero), the whole request or nothing
    const w = kind === 'wallet' ? await partnerWallet.getWallet(tenant._id) : await smsWallet.getWallet(tenant._id);
    const Wallet = kind === 'wallet' ? PartnerWallet : SmsWallet; const Txn = kind === 'wallet' ? PartnerTransaction : SmsTransaction;
    const keys = parts.map((_, i) => `${requestId}:${i}`);
    await withTransaction(async (session) => {
        const after = await Wallet.findOneAndUpdate({ _id: w._id, balancePaise: { $gte: amountPaise } }, { $inc: { balancePaise: -amountPaise } }, { returnDocument: 'after', session });
        if (!after) throw httpError(409, 'The wallet balance is lower than this amount');
        const txn = { tenantId: tenant._id, type: 'adjust', amountPaise: -amountPaise, balanceAfter: after.balancePaise, note: `Refund to the payment method: ${reason}`.slice(0, 200), actor: { type: 'supreme', label: by } };
        await Txn.create([kind === 'sms' ? { ...txn, walletTenantId: w.tenantId } : txn], { session });
        await PlatformRefund.create(parts.map((x, i) => ({
            tenantId: tenant._id, kind, salesKind: kind, sourceId: String(x.t._id), paymentId: x.t.paymentId, cashPaise: x.cash, basePaise: x.cash - x.gst, gstPaise: x.gst, walletPaise: x.base, counted: true, reason, by, key: keys[i],
        })), { session });
    });
    // 2. the money goes back, one top-up at a time; a part the partner refuses is put back into the wallet
    const out = { ok: true, processed: 0, failed: 0, cashPaise: 0 };
    for (let i = 0; i < parts.length; i += 1) {
        const x = parts[i];
        try {
            const r = await askPartner(x.t.paymentId, x.cash, keys[i], reason);
            await PlatformRefund.updateOne({ key: keys[i] }, { $set: { status: 'processed', refundId: r.refundId } });
            await ensureCreditNote((await PlatformRefund.findOne({ key: keys[i] }).select('_id').lean())._id).catch((e) => console.error('Credit note error:', e.message));
            out.processed += 1; out.cashPaise += x.cash;
        } catch (e) {
            await PlatformRefund.updateOne({ key: keys[i] }, { $set: { status: 'failed', error: String(e.message || e).slice(0, 200) } });
            await withTransaction(async (session) => {
                const after = await Wallet.findOneAndUpdate({ _id: w._id }, { $inc: { balancePaise: x.base } }, { returnDocument: 'after', session });
                const txn = { tenantId: tenant._id, type: 'adjust', amountPaise: x.base, balanceAfter: after.balancePaise, note: 'Refund failed at the payment partner: balance put back', actor: { type: 'supreme', label: by } };
                await Txn.create([kind === 'sms' ? { ...txn, walletTenantId: w.tenantId } : txn], { session });
            });
            out.failed += 1;
        }
    }
    return out;
}

const refundPlan = (a) => withShopLock(a.tenant._id, () => refundPlanImpl(a));
const refundWallet = (a) => withShopLock(a.tenant._id, () => refundWalletImpl(a));

module.exports = { overview, refundPlan, refundWallet, endPlanNow, ensureCreditNote };
