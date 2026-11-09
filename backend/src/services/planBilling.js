// The owner's plan money: the quote (what a switch would do and cost), paying for it, and applying it. Money in integer paise.
// One function (quote) feeds both the preview and the payment, so the two can never disagree; the server recomputes it when the money is captured.
//
// Rules (agreed 2026-11-09, docs/plans-and-pricing.md):
//   Growth and Pro are prepaid for 1 to 6 months. The price is x months, less the multi-month discount, plus GST on the discounted amount.
//   Moving up (Growth -> Pro) in a paid term: pay (new price - old price) / 30 x the WHOLE days left, plus GST, starts at once, the end date stays. No discount on that.
//   Same plan again = renew: the new months are added after the current end (or from today when it has ended).
//   Partner (or a free period, or no plan) -> a paid plan: the full price from today. A Partner wallet balance is credited against it once (GST is on what is left).
//   Moving down (Pro -> Growth, or to Partner) is only for the end of the paid term: it is scheduled, nothing is paid.
//   No cash refund of prepaid months. The price shown is locked for the paid term.
const PlanPayment = require('../models/PlanPayment');
const PartnerWallet = require('../models/PartnerWallet');
const PartnerTransaction = require('../models/PartnerTransaction');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const withTransaction = require('./withTransaction');
const planService = require('./planService');
const plans = require('../config/plans');
const invoicing = require('./platformInvoicing');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const { httpError } = require('../middlewares/apiErrors');

const DAY = 86400000;
const IST = 5.5 * 3600000;
const RANK = { partner: 0, growth: 1, pro: 2 };
const NAME = { partner: 'Partner', growth: 'Growth', pro: 'Pro' };

// the India calendar date `n` months after `d`, as the last millisecond of the day before (1 month from 9 Nov ends 8 Dec, 23:59:59.999 IST)
function endAfterMonths(d, n) {
    const t = new Date(d.getTime() + IST);
    const y = t.getUTCFullYear(); const m = t.getUTCMonth() + n; const day = t.getUTCDate();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();   // days in the target month
    const target = Date.UTC(y, m, Math.min(day, last), 23, 59, 59, 999);
    return new Date(target - DAY - IST);
}
// a paid term can start after a free one: the first moment of the day after `end`
const dayAfter = (end) => new Date(end.getTime() + 1);

const priceOf = (def, shop, id) => (id === 'growth' || id === 'pro' ? (shop.plan?.priceOverridePaise ?? def[id].pricePaise) : 0);
// whole days in the owner's favour
const wholeDaysLeft = (endsAt, now) => Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / DAY));

async function gstPercentNow(def) {
    const p = await PlatformSettings.findById('main').select('business.gstin').lean();
    return p?.business?.gstin ? def.gstPercent : 0;   // no GST number, no GST (same rule as the rent and the SMS top-up)
}

// What a switch to `to` (for `months`) would do and cost right now. Pure: writes nothing.
async function quote(tenant, { to, months = 1 }, now = new Date()) {
    if (!plans.isPlan(to)) throw httpError(400, 'Choose Partner, Growth or Pro');
    const def = await planService.getDefaults();
    const p = tenant.plan || {};
    const from = p.id || null;
    const endsAt = p.endsAt ? new Date(p.endsAt) : null;
    const free = !!(p.freeUntil && new Date(p.freeUntil) > now);
    const paidActive = !!(from && from !== 'partner' && endsAt && endsAt > now && !free);
    const out = { from, to, fromName: from ? NAME[from] : null, toName: NAME[to], months: 0, lines: [], gstPercent: 0, gstPaise: 0, totalPaise: 0, walletCreditPaise: 0, features: { on: [], off: [] }, notes: [] };

    // features that turn on / off (the extras the shop already holds stay)
    const label = (k) => plans.FEATURES[k].label;
    const has = (id, k) => !id || plans.planIncludes(id, k) || (p.extras || []).some((e) => e.key === k);
    for (const k of Object.keys(plans.FEATURES)) {
        const was = from ? has(from, k) : false; const will = plans.planIncludes(to, k) || (p.extras || []).some((e) => e.key === k);
        if (!was && will) out.features.on.push(label(k)); if (was && !will) out.features.off.push(label(k));
    }

    if (to === from && !(from === 'partner')) out.kind = 'renew';
    else if (from && RANK[to] > RANK[from] && paidActive) out.kind = 'upgrade';
    else if (from && RANK[to] < RANK[from]) out.kind = 'downgrade';
    else out.kind = 'new';

    if (to === 'partner') {   // no payment: a scheduled move at the end of the paid term, or at once when there is nothing paid
        out.kind = paidActive ? 'downgrade' : 'switch';
        out.startsAt = paidActive ? dayAfter(endsAt) : now;
        out.notes.push(paidActive ? `Partner starts on ${endsAt.toISOString().slice(0, 10)} when your paid time ends. Until then you keep ${NAME[from]}.` : 'Partner has no monthly price. You pay a small fee per completed order from your wallet.');
        return out;
    }
    if (out.kind === 'downgrade') {
        out.startsAt = dayAfter(endsAt || now);
        out.notes.push(`${NAME[to]} starts when your paid time ends. Until then you keep ${NAME[from]}. No refund for the rest of the term.`);
        return out;
    }

    const gstPercent = await gstPercentNow(def);
    out.gstPercent = gstPercent;

    if (out.kind === 'upgrade') {
        const days = wholeDaysLeft(endsAt, now);
        const diff = priceOf(def, tenant, to) - priceOf(def, tenant, from);
        const base = Math.max(0, Math.round((diff * days) / 30));
        out.months = 0;
        out.lines.push({ label: `${NAME[from]} to ${NAME[to]}: Rs ${(diff / 100).toFixed(0)} difference x ${days} days left of 30`, paise: base });
        out.taxablePaise = base;
        out.startsAt = now; out.endsAt = endsAt; out.daysLeft = days;
        out.notes.push(`${NAME[to]} starts now and runs until ${endsAt.toISOString().slice(0, 10)}.`);
    } else {
        const m = Number(months);
        if (!Number.isInteger(m) || m < 1 || m > 6) throw httpError(400, 'Choose 1 to 6 months');
        out.months = m;
        const monthly = priceOf(def, tenant, to);
        const gross = monthly * m;
        const pct = def.monthDiscounts[m] || 0;
        const disc = Math.round((gross * pct) / 100);
        out.lines.push({ label: `${NAME[to]} x ${m} month${m > 1 ? 's' : ''}`, paise: gross });
        if (disc) out.lines.push({ label: `${m} months discount ${pct}%`, paise: -disc });
        let taxable = gross - disc;
        // a Partner wallet balance is credited once against the price; the leftover stays in the wallet
        if (from === 'partner' && taxable > 0) {
            const w = await PartnerWallet.findOne({ tenantId: tenant._id }).select('balancePaise').lean();
            const credit = Math.max(0, Math.min(w?.balancePaise || 0, taxable));
            if (credit) { out.walletCreditPaise = credit; out.lines.push({ label: 'Wallet balance adjusted (GST already paid on it)', paise: -credit }); taxable -= credit; }
        }
        out.taxablePaise = taxable;
        // renew in time: the new months come after the current end; after a free period too; otherwise from now
        const sameFree = free && from === to;
        const after = (out.kind === 'renew' && paidActive) || sameFree ? dayAfter(endsAt) : now;
        out.startsAt = after; out.endsAt = endAfterMonths(after, m);
        out.notes.push(`${NAME[to]} runs until ${out.endsAt.toISOString().slice(0, 10)}. The price is locked for this term.`);
    }
    out.gstPaise = Math.round((out.taxablePaise * gstPercent) / 100);   // GST is worked out once, on the whole taxable amount
    out.totalPaise = out.taxablePaise + out.gstPaise;
    out.canPay = out.totalPaise >= 100;   // below Rs 1 nothing is paid online: wallet credit may cover it all (then the owner confirms without paying)
    out.free = out.totalPaise === 0;
    out.notes.push('No refund of prepaid months.');
    return out;
}

// the owner's whole picture for the Plan screen
async function overview(tenant, now = new Date()) {
    const def = await planService.getDefaults();
    const v = planService.viewOf(tenant, now);
    const wallet = v.id === 'partner' ? await require('./partnerWalletService').status(tenant._id) : null;
    const recent = await PlanPayment.find({ tenantId: tenant._id, status: { $in: ['paid', 'held'] } }).sort({ createdAt: -1 }).limit(10).select('to months status payablePaise paidAt invoice.invoiceNo').lean();
    return {
        current: v, scheduled: tenant.plan?.scheduled || null, wallet,
        plans: plans.PLAN_IDS.map((id) => ({
            id, name: NAME[id], pricePaise: priceOf(def, tenant, id), feeRange: id === 'partner' ? { minRs: def.partner.feeMinRs, maxRs: def.partner.feeMaxRs } : null,
            features: plans.featuresOf(id), limits: { riders: plans.limitFor(id, 'riders'), staff: plans.limitFor(id, 'staff') },
        })),
        featureLabels: Object.fromEntries(Object.entries(plans.FEATURES).map(([k, f]) => [k, f.label])),
        discounts: def.monthDiscounts, gstPercent: await gstPercentNow(def),
        payments: recent.map((r) => ({ id: String(r._id), to: r.to, months: r.months, status: r.status, payablePaise: r.payablePaise, paidAt: r.paidAt, invoiceNo: r.invoice?.invoiceNo || null })),
    };
}

// Start paying: store the quote exactly as shown. One pending payment per shop (a second start reuses it while nothing changed).
async function createPayment(tenant, { to, months = 1 }, actor) {
    if (to === 'partner') throw httpError(400, 'Partner has nothing to pay');
    const q = await quote(tenant, { to, months });
    if (q.kind === 'downgrade') throw httpError(409, 'A lower plan starts when your paid time ends. Nothing to pay now.');
    if (!q.canPay && !q.free) throw httpError(400, 'This is too small to pay online. Contact support.');
    const open = await PlanPayment.findOne({ tenantId: tenant._id, status: 'pending', expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (open && open.to === to && open.months === q.months && open.payablePaise === q.totalPaise && open.rzpOrderId) return { payment: open, quote: q, reused: true };
    if (open) await PlanPayment.updateOne({ _id: open._id }, { $set: { status: 'expired' } });   // a changed choice replaces the old one
    const row = new PlanPayment({
        tenantId: tenant._id, kind: q.kind, from: q.from, to, months: q.months, quote: q, payablePaise: q.totalPaise,
        expiresAt: new Date(Date.now() + 30 * 60000), createdBy: actor,
    });
    return { payment: row, quote: q, reused: false };
}

// The money was captured (app verify or webhook). Applies the plan ONCE. If the shop's situation changed since the owner saw the quote
// (a different plan, or the term moved), the payment is HELD for the supreme admin instead of being applied blindly.
async function settle(paymentId, { payId, amountPaise, via = 'app' }) {
    const row = await PlanPayment.findById(paymentId);
    if (!row) throw httpError(404, 'Payment not found');
    if (row.status === 'paid') return { ok: true, duplicate: true };
    if (amountPaise !== row.payablePaise) {
        await PlanPayment.updateOne({ _id: row._id }, { $set: { status: 'held', heldWhy: `Paid ${amountPaise} paise but the quote was ${row.payablePaise}`, paymentId: payId } });
        throw httpError(409, 'The amount paid does not match this plan. We are checking it. Please contact support.');
    }
    const tenant = await Tenant.findById(row.tenantId).select('slug plan name phone address business').lean();
    const q = row.quote;
    // the plan the owner started from must still be the plan held, and an upgrade needs the same end date
    const now = new Date();
    const same = (tenant.plan?.id || null) === row.from && (row.kind !== 'upgrade' || (tenant.plan?.endsAt && new Date(tenant.plan.endsAt).getTime() === new Date(q.endsAt).getTime()));
    if (!same) {
        await PlanPayment.updateOne({ _id: row._id }, { $set: { status: 'held', heldWhy: 'The shop plan changed after the owner saw the price', paymentId: payId, paidAt: now } });
        try { await require('./paymentAlerts')('admin_webhook_failed', { tenantId: row.tenantId, vars: { event: 'plan payment', error: `Payment ${payId} of Rs ${(row.payablePaise / 100).toFixed(2)} is HELD: the shop plan changed after the owner saw the price. Refund it or apply the plan by hand.` } }); } catch (e) { /* the alert is best effort */ }
        return { ok: true, held: true };
    }
    // apply: plan fields, wallet credit used (Partner), the payment row, all in one transaction
    try {
        await withTransaction(async (session) => {
            const claim = await PlanPayment.findOneAndUpdate({ _id: row._id, status: { $in: ['pending', 'expired'] } }, { $set: { status: 'paid', paidAt: now, appliedAt: now, paymentId: payId } }, { returnDocument: 'after', session });
            if (!claim) return;   // someone else applied it a moment ago
            const p = { ...(tenant.plan || {}) };
            const history = [...(p.history || []).slice(-49), { at: now, by: 'owner payment', from: row.from, to: row.to, note: `${row.kind} ${row.months || ''}`.trim() }];
            p.id = row.to; p.history = history; delete p.scheduled;
            if (row.kind === 'upgrade') { p.startedAt = now; /* the end date stays */ p.freeUntil = undefined; }
            else { p.startedAt = new Date(q.startsAt); p.endsAt = new Date(q.endsAt); p.freeUntil = undefined; if (new Date(q.startsAt) <= now) p.startedAt = now; }
            p.extras = (p.extras || []).filter((e) => !plans.planIncludes(row.to, e.key));
            await Tenant.updateOne({ _id: row.tenantId }, { $set: { plan: p } }, { session });
            if (q.walletCreditPaise > 0) {
                const w = await PartnerWallet.findOneAndUpdate({ tenantId: row.tenantId, balancePaise: { $gte: q.walletCreditPaise } }, { $inc: { balancePaise: -q.walletCreditPaise } }, { returnDocument: 'after', session });
                if (w) await PartnerTransaction.create([{ tenantId: row.tenantId, type: 'plan_credit', amountPaise: -q.walletCreditPaise, balanceAfter: w.balancePaise, paymentId: `plancredit:${row._id}`, note: `Wallet balance adjusted against ${NAME[row.to]}`, actor: { type: 'system', label: 'plan' } }], { session });
            }
        });
    } catch (e) { if (e && e.code === 11000) return { ok: true, duplicate: true }; throw e; }
    invalidateTenant(tenant.slug);
    await ensureInvoice(row._id).catch((e) => console.error('Plan invoice error:', e.message));
    return { ok: true, applied: true };
}

// The tax invoice of a PAID plan payment, made once.
async function ensureInvoice(paymentId) {
    const r = await PlanPayment.findById(paymentId).lean();
    if (!r || r.status !== 'paid') return null;
    if (r.invoice?.invoiceNo) return r.invoice;
    const platform = await PlatformSettings.findById('main').select('business').lean();
    if (!platform?.business?.legalName) return null;
    const tenant = await Tenant.findById(r.tenantId).select('name phone address business').lean();
    if (!tenant) return null;
    const issueDate = r.paidAt || new Date();
    const num = await invoicing.allocate('PLN', { now: issueDate });
    const { seller, buyer } = invoicing.parties(platform.business, tenant);
    const q = r.quote;
    const lineItems = q.lines.map((l) => ({ description: l.label, qty: 1, rate: l.paise / 100, amount: l.paise / 100 }));
    const baseAmount = (q.taxablePaise || 0) / 100;
    const gstAmount = (q.gstPaise || 0) / 100;
    const tax = invoicing.taxFor({ seller, buyer, gstAmount });
    const invoice = {
        invoiceNo: num.invoiceNo, kind: 'plan', issueDate, status: 'paid', paidAt: issueDate, paymentMode: 'online', paymentRef: r.paymentId || undefined,
        description: `${NAME[r.to]} plan`, lineItems, baseAmount, gstPercent: q.gstPercent || 0, gstAmount, total: r.payablePaise / 100, reverseCharge: false, ...tax, seller, buyer,
    };
    const u = await PlanPayment.updateOne({ _id: r._id, 'invoice.invoiceNo': { $exists: false } }, { $set: { invoice } });
    if (!u.modifiedCount) { await num.undo(); return (await PlanPayment.findById(r._id).select('invoice').lean())?.invoice || null; }
    return invoice;
}

// A move that costs nothing: down to Partner / lower plan at the end of the term (scheduled), or at once when nothing is paid. Also a covered-by-wallet plan (total 0).
async function chooseFree(tenant, { to, months = 1 }, actor) {
    const q = await quote(tenant, { to, months });
    const now = new Date();
    const by = actor?.label || 'owner';
    if (q.kind === 'downgrade') {
        await Tenant.updateOne({ _id: tenant._id }, { $set: { 'plan.scheduled': { to, at: q.startsAt, by, requestedAt: now } } });
        invalidateTenant(tenant.slug);
        return { scheduled: true, quote: q };
    }
    if (q.kind === 'switch' && to === 'partner') {
        const t = await Tenant.findById(tenant._id);
        const v = await planService.setPlan(t, { to: 'partner', by });
        return { switched: true, plan: v, quote: q };
    }
    throw httpError(409, 'This needs a payment');
}
// the owner changes his mind before the scheduled move happens
async function cancelScheduled(tenant) {
    await Tenant.updateOne({ _id: tenant._id }, { $unset: { 'plan.scheduled': 1 } });
    invalidateTenant(tenant.slug);
    return { ok: true };
}

// total Rs 0 (the wallet balance covers the price): no Razorpay, the owner confirms and the plan is applied
async function payFree(tenant, { to, months = 1 }, actor) {
    const { payment, quote: q } = await createPayment(tenant, { to, months }, actor);
    if (!q.free) throw httpError(409, 'This needs a payment');
    await payment.save();
    return settle(payment._id, { payId: `free:${payment._id}`, amountPaise: 0 });
}

module.exports = { payFree, quote, overview, createPayment, settle, ensureInvoice, chooseFree, cancelScheduled, endAfterMonths, wholeDaysLeft };
