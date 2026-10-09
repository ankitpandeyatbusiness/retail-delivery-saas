// The "Pay now / Remind me later" warnings for the owner.
//
//   bill: an unpaid monthly bill that has a grace date.
//         In grace  -> can be postponed ("Remind me later").
//         Paused    -> cannot be postponed, the owner must pay.
//   sms:  low SMS balance can be postponed. A balance of zero that blocks customer login cannot.
//
// The warning keeps coming back: a postponed warning shows again after 6 hours (or when grace ends, if that is sooner).
// "Pay now" hides it for 30 minutes while the owner pays. Every choice is written to the activity log.
const BillingPrompt = require('../models/BillingPrompt');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const wallet = require('./smsWalletService');
const auditTrail = require('../middlewares/auditTrail');
const { httpError } = require('../middlewares/apiErrors');

const DAY_MS = 86400000;
const REMIND_MS = 6 * 3600000;
const PAY_NOW_MS = 30 * 60000;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const rs = (n) => `Rs ${round2(n)}`;
const rsPaise = (p) => `Rs ${(p / 100).toFixed(2)}`;

async function billState(tenantId, now) {
    const [owed] = await SubscriptionInvoice.aggregate([
        { $match: { tenantId, status: 'pending', graceEndsAt: { $type: 'date' } } },
        { $sort: { graceEndsAt: 1 } },
        {
            $group: {
                _id: '$tenantId', amount: { $sum: '$total' }, count: { $sum: 1 },
                graceEndsAt: { $min: '$graceEndsAt' }, firstId: { $first: '$_id' },
            },
        },
    ]);
    if (!owed) return null;
    const paused = owed.graceEndsAt <= now;
    return {
        refId: String(owed.firstId),
        paused,
        amount: round2(owed.amount),
        count: owed.count,
        graceEndsAt: owed.graceEndsAt,
        graceDaysLeft: paused ? 0 : Math.max(1, Math.ceil((owed.graceEndsAt - now) / DAY_MS)),
        canSnooze: !paused,
    };
}

async function smsState(tenantId) {
    const s = await wallet.status(tenantId);
    if (!s.low && !s.zero) return null;
    return { refId: 'sms', ...s, canSnooze: !(s.zero && s.blockAtZero) };
}

const stateOf = (kind, tenantId, now) => (kind === 'bill' ? billState(tenantId, now) : smsState(tenantId));

function describe(kind, st) {
    if (kind === 'bill') {
        return st.paused
            ? {
                severity: 'blocked', title: 'Your shop is paused',
                message: `A bill of ${rs(st.amount)} is unpaid, so new orders are stopped. Pay now to start taking orders again.`,
            }
            : {
                severity: 'warning', title: 'You have an unpaid bill',
                message: `Please pay ${rs(st.amount)} within ${st.graceDaysLeft} day(s) to keep taking orders.`,
            };
    }
    if (st.zero) {
        return {
            severity: 'blocked', title: 'SMS balance is finished',
            message: st.blockAtZero
                ? 'Customers cannot log in until you top up your SMS balance.'
                : 'Your SMS balance is finished. Please top up.',
        };
    }
    return {
        severity: 'warning', title: 'SMS balance is low',
        message: `Your SMS balance is ${rsPaise(st.balancePaise)}. Top up so customers can keep logging in.`,
    };
}

async function decorate(tenantId, kind, st, now) {
    const saved = await BillingPrompt.findOne({ tenantId, kind, refId: st.refId }).select('snoozedUntil').lean();
    const snoozedUntil = saved?.snoozedUntil || null;
    const show = !st.canSnooze || !snoozedUntil || snoozedUntil <= now;
    const base = {
        kind, show, canSnooze: st.canSnooze, snoozedUntil, ...describe(kind, st),
        payScreen: kind === 'bill' ? 'billing' : 'sms_topup',   // the app opens this screen on "Pay now"
    };
    if (kind === 'bill') {
        return { ...base, amount: st.amount, invoiceCount: st.count, graceEndsAt: st.graceEndsAt, graceDaysLeft: st.graceDaysLeft };
    }
    return { ...base, balancePaise: st.balancePaise, lowBalancePaise: st.lowBalancePaise, zero: st.zero };
}

// Everything the owner must be warned about right now. The app opens a pop-up for the first item with show: true.
async function list(tenantId, now = new Date()) {
    const [bill, sms] = await Promise.all([billState(tenantId, now), smsState(tenantId)]);
    const items = [];
    if (bill) items.push(await decorate(tenantId, 'bill', bill, now));
    if (sms) items.push(await decorate(tenantId, 'sms', sms, now));
    return items;
}

async function choose({ tenantId, kind, choice, actor }) {
    if (!['bill', 'sms'].includes(kind)) throw httpError(400, 'kind must be "bill" or "sms"');
    if (!['pay_now', 'remind_later'].includes(choice)) throw httpError(400, 'choice must be "pay_now" or "remind_later"');

    const now = new Date();
    const st = await stateOf(kind, tenantId, now);
    if (!st) throw httpError(409, 'There is nothing to confirm right now');

    let snoozedUntil = null;
    if (choice === 'remind_later') {
        if (!st.canSnooze) throw httpError(409, 'Please pay to continue. This reminder cannot be postponed.');
        snoozedUntil = new Date(now.getTime() + REMIND_MS);
        if (kind === 'bill' && st.graceEndsAt < snoozedUntil) snoozedUntil = st.graceEndsAt;
    } else if (st.canSnooze) {
        snoozedUntil = new Date(now.getTime() + PAY_NOW_MS);
    }

    await BillingPrompt.findOneAndUpdate(
        { tenantId, kind, refId: st.refId },
        { $set: { lastChoice: choice, lastChoiceAt: now, snoozedUntil } },
        { upsert: true },
    );

    // readable line in the owner's activity log (the normal request log is written as well)
    try {
        await auditTrail.record({
            actorType: actor.type, actorLabel: actor.label || actor.type, tenantId, status: 200,
            action: `${kind === 'bill' ? 'BILL' : 'SMS'}_REMINDER_${choice === 'pay_now' ? 'PAY_NOW' : 'REMIND_LATER'}`,
            params: kind === 'bill'
                ? { choice, amount: st.amount, graceEndsAt: st.graceEndsAt, paused: st.paused }
                : { choice, balancePaise: st.balancePaise, zero: st.zero },
        });
    } catch (e) {
        console.error('Reminder log error:', e.message);
    }

    return { ok: true, kind, choice, snoozedUntil, payScreen: kind === 'bill' ? 'billing' : 'sms_topup' };
}

module.exports = { list, choose };