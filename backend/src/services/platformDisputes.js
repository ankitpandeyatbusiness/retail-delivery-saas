// Bank disputes (chargebacks) on what a shop paid the platform: plan payments, Partner wallet top-ups, SMS top-ups.
// Safe to receive twice and in any order (an open stage never overwrites a final one). The superadmin is told when a dispute opens, needs a reply, is won or is lost.
// When a dispute is LOST the bank has taken the money back, so the service it paid for is taken back too and a credit note is made:
//   wallet / SMS  the wallet money comes out (the Partner wallet may go below zero, so new orders stop until the shop pays; an SMS balance only to zero)
//   plan          the plan ends at once if that payment is the term now running
// While a dispute is open, an emergency refund of the same payment is refused (it would pay the same money twice): see services/emergencyRefund.js.
const PlatformDispute = require('../models/PlatformDispute');
const PlatformRefund = require('../models/PlatformRefund');
const PlanPayment = require('../models/PlanPayment');
const PartnerTopup = require('../models/PartnerTopup');
const SmsTopup = require('../models/SmsTopup');
const PartnerWallet = require('../models/PartnerWallet');
const PartnerTransaction = require('../models/PartnerTransaction');
const SmsWallet = require('../models/SmsWallet');
const SmsTransaction = require('../models/SmsTransaction');
const Tenant = require('../models/Tenant');
const withTransaction = require('./withTransaction');
const alert = require('./adminAlerts');

const OPEN = ['created', 'under_review', 'action_required'];
const FINAL = ['won', 'lost', 'closed'];
const TOLD = ['created', 'action_required', 'won', 'lost'];
const rupees = (paise) => (paise / 100).toFixed(2);
const WHAT = { plan: 'a plan payment', wallet: 'a wallet top-up', sms: 'an SMS top-up' };

async function sourceOf(rzpPaymentId) {
    if (!rzpPaymentId) return null;
    const plan = await PlanPayment.findOne({ paymentId: rzpPaymentId }).lean();
    if (plan) return { kind: 'plan', doc: plan };
    const wallet = await PartnerTopup.findOne({ paymentId: rzpPaymentId }).lean();
    if (wallet) return { kind: 'wallet', doc: wallet };
    const sms = await SmsTopup.findOne({ paymentId: rzpPaymentId }).lean();
    if (sms) return { kind: 'sms', doc: sms };
    return null;
}

const wordsOf = (status, src, amountPaise, respondBy) => {
    const by = respondBy ? ` Reply by ${respondBy.toISOString().slice(0, 10)}.` : '';
    const what = `${WHAT[src.kind]} of Rs ${rupees(amountPaise)}`;
    switch (status) {
        case 'created': return `A bank questioned ${what}.${by} Money is at risk: check Razorpay.`;
        case 'action_required': return `The dispute on ${what} needs a reply.${by}`;
        case 'won': return `You won the dispute on ${what}. The money stays with you.`;
        default: return `The dispute on ${what} was LOST. The bank took the money back. The service was taken back and a credit note was made.`;
    }
};

// the bank took the money: take the service back, once (the unique key of the PlatformRefund row makes a repeat do nothing)
async function clawBack(src, entity, dispute) {
    const d = src.doc;
    const payable = src.kind === 'plan' ? d.payablePaise : (Number.isInteger(d.payablePaise) ? d.payablePaise : d.amountPaise);
    const amount = Math.min(Number.isInteger(entity.amount) && entity.amount > 0 ? entity.amount : payable, payable);
    const gstTotal = src.kind === 'plan' ? (d.quote?.gstPaise || 0) : (d.gstPaise || 0);
    const gst = payable ? Math.round((amount * gstTotal) / payable) : 0;
    const walletPaise = src.kind === 'plan' ? 0 : Math.round((amount * d.amountPaise) / payable);
    let row;
    try {
        row = await PlatformRefund.create({
            tenantId: d.tenantId, kind: src.kind, salesKind: src.kind === 'plan' && d.kind === 'branch' ? 'branch' : src.kind, sourceId: String(d._id), paymentId: d.paymentId,
            cashPaise: amount, basePaise: amount - gst, gstPaise: gst, walletPaise, counted: src.kind !== 'plan' || d.status === 'paid',
            status: 'processed', refundId: entity.id, reason: 'Bank dispute lost: the bank took the money back', by: 'bank dispute', key: `dispute:${entity.id}`,
        });
    } catch (e) { if (e && e.code === 11000) return; throw e; }
    const tenant = await Tenant.findById(d.tenantId).select('slug plan').lean();
    if (src.kind === 'wallet') {
        await withTransaction(async (session) => {
            const after = await PartnerWallet.findOneAndUpdate({ tenantId: d.tenantId }, { $inc: { balancePaise: -walletPaise } }, { returnDocument: 'after', session });
            if (after) await PartnerTransaction.create([{ tenantId: d.tenantId, type: 'adjust', amountPaise: -walletPaise, balanceAfter: after.balancePaise, note: 'Bank dispute lost: the money was taken back', actor: { type: 'system', label: 'bank dispute' } }], { session });
        });
    } else if (src.kind === 'sms') {
        const w = await SmsWallet.findOne({ tenantId: d.tenantId });
        if (w) {
            const take = Math.min(w.balancePaise > 0 ? w.balancePaise : 0, walletPaise);
            if (take > 0) await withTransaction(async (session) => {
                const after = await SmsWallet.findOneAndUpdate({ _id: w._id, balancePaise: { $gte: take } }, { $inc: { balancePaise: -take } }, { returnDocument: 'after', session });
                if (after) await SmsTransaction.create([{ tenantId: d.tenantId, walletTenantId: w.tenantId, type: 'adjust', amountPaise: -take, balanceAfter: after.balancePaise, note: 'Bank dispute lost: the money was taken back', actor: { type: 'system', label: 'bank dispute' } }], { session });
            });
        }
    } else if (tenant && tenant.plan && d.status === 'paid' && d.kind !== 'branch' && tenant.plan.endsAt && d.quote?.endsAt && Math.abs(new Date(tenant.plan.endsAt) - new Date(d.quote.endsAt)) < 1000 && new Date(tenant.plan.endsAt) > new Date()) {
        await require('./emergencyRefund').endPlanNow(d.tenantId, tenant.slug);
    }
    await PlatformDispute.updateOne({ _id: dispute._id }, { $set: { clawedBack: true } });
    await require('./emergencyRefund').ensureCreditNote(row._id).catch((e) => console.error('Credit note error:', e.message));
}

async function onEvent({ name, entity }) {
    if (!entity || !entity.id) return { ignored: 'no_dispute' };
    const status = String(name).split('.').pop();
    if (![...OPEN, ...FINAL].includes(status)) return { ignored: name };
    const src = await sourceOf(entity.payment_id);
    if (!src) {
        await alert.alert('admin_platform_dispute', { vars: { summary: `Dispute ${entity.id} is for a payment we do not know. Check Razorpay.` }, supremeOnly: true });
        return { ignored: 'unknown_payment' };
    }
    const now = new Date();
    const fields = { amountPaise: Number.isInteger(entity.amount) ? entity.amount : 0, reasonCode: entity.reason_code, respondBy: entity.respond_by ? new Date(entity.respond_by * 1000) : undefined };
    let changed = false;
    let dispute = null;
    try {
        dispute = await PlatformDispute.create({ tenantId: src.doc.tenantId, kind: src.kind, sourceId: String(src.doc._id), rzpPaymentId: entity.payment_id, rzpDisputeId: entity.id, status, ...fields, history: [{ status, at: now }] });
        changed = true;
    } catch (e) { if (e.code !== 11000) throw e; }
    if (!changed) {
        const from = FINAL.includes(status) ? OPEN : OPEN.filter((s) => s !== status);   // only an OPEN dispute moves on, never to the same stage
        const set = { status, ...fields };
        Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);
        const r = await PlatformDispute.updateOne({ rzpDisputeId: entity.id, status: { $in: from } }, { $set: set, $push: { history: { status, at: now } } });
        changed = r.modifiedCount === 1;
        dispute = await PlatformDispute.findOne({ rzpDisputeId: entity.id }).lean();
    }
    if (!changed) return { duplicate: true };
    if (TOLD.includes(status)) await alert.alert('admin_platform_dispute', { tenantId: src.doc.tenantId, vars: { summary: wordsOf(status, src, fields.amountPaise || entity.amount || 0, fields.respondBy) }, supremeOnly: true });
    if (status === 'lost') await clawBack(src, entity, dispute);
    return { dispute: status };
}

// is a dispute open on this payment? (an emergency refund of it must wait)
const hasOpen = (kind, sourceId) => PlatformDispute.exists({ kind, sourceId: String(sourceId), status: { $in: OPEN } });

module.exports = { onEvent, hasOpen, OPEN, FINAL };
