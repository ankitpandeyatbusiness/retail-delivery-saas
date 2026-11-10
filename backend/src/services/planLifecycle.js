// What happens as a plan runs out (and as a Partner wallet runs down). Run from the billing alerts scheduler every 10 minutes.
// IDEMPOTENT: every message and every state change is CLAIMED on the shop first (marker keyed by the end date), so two servers, a restart, or a job
// that was down for a day (it catches up) never send twice or skip a step. A renewal changes the end date, so the markers start clean.
//
//   7, 3, 1 days before the end  -> "plan_ending" (owner push + superadmin feed)
//   the end                       -> a scheduled lower plan starts (Partner at once; a lower paid plan starts "ended" and must be paid), "plan_ended"
//   end + grace days (default 3)  -> the shop is PAUSED: new orders stop, running orders finish, the owner can still open Plan and pay
//   Partner wallet                -> "wallet_low" under 20% of the last top-up, "wallet_empty" at zero; once per dip (a top-up clears the marks)
const Tenant = require('../models/Tenant');
const PartnerWallet = require('../models/PartnerWallet');
const planService = require('./planService');
const plans = require('../config/plans');
const center = require('../notifications/center');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');

const DAY = 86400000;
const NAME = { partner: 'Partner', growth: 'Growth', pro: 'Pro' };
const dayText = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
const safe = (fn) => { try { const r = fn(); if (r && r.catch) r.catch((e) => console.error('Plan alert error:', e.message)); } catch (e) { console.error('Plan alert error:', e.message); } };

// the end of grace: the last moment of the Nth India day after the plan ended
const graceEnd = (endsAt, graceDays) => planService.endOfIstDay(new Date(endsAt), graceDays);

// claim a marker: true only for the ONE caller that sets it (so the message is sent once)
async function claim(tenantId, key, value) {
    const r = await Tenant.updateOne({ _id: tenantId, [`plan.notified.${key}`]: { $ne: value } }, { $set: { [`plan.notified.${key}`]: value } });
    return r.modifiedCount === 1;
}

// tells the owner and the superadmin that a plan was changed: who, from which plan, to which.
// admin: true = the platform team changed it. The owner reads "Changed by the Platform" (never the admin's own name or email); the superadmin alert keeps who did it.
function notifyChanged({ tenantId, from, to, by, admin }) {
    const was = from ? NAME[from] : 'No plan';
    const vars = { summary: `${was} to ${NAME[to]}, by ${by || 'the platform team'}` };   // the admin text (English)
    const base = { tenantId, title: 'Your plan was changed', vars, data: { prompt: 'plan' } };
    // the owner text is fixed words + values (translated by pattern)
    safe(() => center.notify('plan_changed', admin
        ? { ...base, body: `${was} to ${NAME[to]}. Changed by the Platform.` }
        : { ...base, body: `${was} to ${NAME[to]}, by ${by || 'the platform team'}.` }));
}

// the platform team took the plan away: the owner reads "Changed by the Platform", the superadmin alert keeps who
function notifyRemoved({ tenantId, from, by }) {
    safe(() => center.notify('plan_changed', {
        tenantId, title: 'Your plan was changed', body: 'Your plan was removed. Changed by the Platform.',
        vars: { summary: `${from ? NAME[from] : 'The plan'} was removed, by ${by || 'the platform team'}` }, data: { prompt: 'plan' },
    }));
}

async function one(t, def, now) {
    const p = t.plan;
    if (!p?.endsAt) return;
    const endsAt = new Date(p.endsAt);
    const mark = endsAt.toISOString();
    const left = endsAt.getTime() - now.getTime();

    if (left > 0) {   // not ended: the 7 / 3 / 1 day reminders (only the nearest one that is due, so a late job does not send three at once)
        const days = Math.ceil(left / DAY);
        const due = [1, 3, 7].find((d) => days <= d);
        if (due && (await claim(t._id, `r${due}`, mark))) {
            const summary = `${NAME[p.id]} ends on ${dayText(endsAt)} (${days} day${days === 1 ? '' : 's'} left)`;   // the admin text (English)
            safe(() => center.notify('plan_ending', { tenantId: t._id, title: 'Your plan is ending', body: `${NAME[p.id]} ends on ${dayText(endsAt)}. Days left: ${days}. Renew to keep every feature.`, vars: { summary }, data: { prompt: 'plan' } }));
        }
        return;
    }

    // ended. First a scheduled lower plan.
    if (p.scheduled && new Date(p.scheduled.at) <= new Date(endsAt.getTime() + 1) && p.scheduled.to) {
        const from = p.id; const to = p.scheduled.to;
        const np = { ...p, id: to, startedAt: now, extras: (p.extras || []).filter((e) => !plans.planIncludes(to, e.key)), history: [...(p.history || []).slice(-49), { at: now, by: 'scheduled move', from, to, note: 'paid time ended' }] };
        delete np.scheduled; delete np.notified; delete np.paused;
        if (to === 'partner') { delete np.endsAt; delete np.freeUntil; }   // Partner has no end date
        const r = await Tenant.updateOne({ _id: t._id, 'plan.id': from, 'plan.scheduled.to': to }, { $set: { plan: np } });
        if (r.modifiedCount) {
            invalidateTenant(t.slug);
            await require('./brandPlan').afterPlanChange(await Tenant.findById(t._id).select('brandId').lean());
            notifyChanged({ tenantId: t._id, from, to, by: 'the plan you chose at the end of your term' });
            if (to === 'partner') return;
            t = { ...t, plan: np };   // a lower paid plan has nothing paid yet: it is ended and goes through grace like any other
            return one(t, def, now);
        }
        return;
    }

    if (await claim(t._id, 'ended', mark)) {
        const summary = `${NAME[p.id]} ended on ${dayText(endsAt)}. ${def.graceDays} grace day${def.graceDays === 1 ? '' : 's'} to choose a plan`;   // the admin text (English)
        safe(() => center.notify('plan_ended', { tenantId: t._id, title: 'Your plan has ended', body: `${NAME[p.id]} ended on ${dayText(endsAt)}. Grace days to choose a plan: ${def.graceDays}. After that new orders stop.`, vars: { summary }, data: { prompt: 'plan' } }));
    }
    if (!p.paused && now.getTime() > graceEnd(endsAt, def.graceDays).getTime()) {
        const r = await Tenant.updateOne({ _id: t._id, 'plan.paused': { $ne: true }, 'plan.endsAt': endsAt }, { $set: { 'plan.paused': true } });
        if (r.modifiedCount) {
            invalidateTenant(t.slug);
            await require('./brandPlan').afterPlanChange(await Tenant.findById(t._id).select('brandId').lean());
            await claim(t._id, 'paused', mark);
            safe(() => center.notify('plan_paused', { tenantId: t._id, title: 'Your shop is paused', body: 'Your plan was not renewed. New orders have stopped. Open Plan to choose and pay. Running orders can be finished.', vars: {}, data: { prompt: 'plan' } }));
        }
    }
}

// Partner wallets: low and empty, once per dip
async function wallets(now) {
    const def = await planService.getDefaults();
    const shops = await Tenant.find({ status: 'active', 'plan.id': 'partner' }).select('_id name slug plan').lean();
    for (const t of shops) {
        const w = await PartnerWallet.findOne({ tenantId: t._id }).lean();
        if (!w) continue;
        const lowAt = Math.round(((w.lastTopupPaise || 0) * def.walletLowPercent) / 100);
        const rs = (paise) => `Rs ${(paise / 100).toFixed(0)}`;
        if (w.balancePaise <= 0) {
            const c = await PartnerWallet.updateOne({ _id: w._id, zeroAlertedAt: { $in: [null, undefined] } }, { $set: { zeroAlertedAt: now, lowAlertedAt: w.lowAlertedAt || now } });
            if (c.modifiedCount) {
                const summary = `The wallet is ${w.balancePaise < 0 ? `${rs(-w.balancePaise)} in overdraft` : 'finished'}`;   // the admin text (English)
                const body = w.balancePaise < 0 ? `The wallet is ${rs(-w.balancePaise)} in overdraft. Add money so new orders can keep coming.` : 'The wallet is finished. Add money so new orders can keep coming.';
                safe(() => center.notify('wallet_empty', { tenantId: t._id, title: 'Your wallet is finished', body, vars: { summary }, data: { prompt: 'wallet' } }));
            }
        } else if (lowAt > 0 && w.balancePaise <= lowAt) {
            const c = await PartnerWallet.updateOne({ _id: w._id, lowAlertedAt: { $in: [null, undefined] } }, { $set: { lowAlertedAt: now } });
            if (c.modifiedCount) {
                const summary = `The wallet has ${rs(w.balancePaise)} left`;   // the admin text (English)
                safe(() => center.notify('wallet_low', { tenantId: t._id, title: 'Your wallet is running low', body: `The wallet has ${rs(w.balancePaise)} left. Add money soon.`, vars: { summary }, data: { prompt: 'wallet' } }));
            }
        }
    }
}

async function sweep(now = new Date()) {
    const def = await planService.getDefaults();
    const shops = await Tenant.find({ status: 'active', 'plan.id': { $in: ['growth', 'pro'] }, 'plan.endsAt': { $type: 'date' }, 'plan.inheritedFrom': { $exists: false } }).select('_id name slug plan').lean();
    for (const t of shops) {
        try { await one(t, def, now); } catch (e) { console.error('Plan lifecycle error:', e.message); }
    }
    await wallets(now).catch((e) => console.error('Wallet alerts error:', e.message));
}

module.exports = { sweep, one, wallets, notifyChanged, notifyRemoved, graceEnd };
