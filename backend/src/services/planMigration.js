// Phase 9: move the shops that exist today onto the plans. Every shop with no plan yet gets PRO, FREE for 30 days from the day of the move (no charge),
// then it sees "Choose your plan". Nothing is deleted and nothing is charged.
//
//   preview()          a DRY RUN: who would move, who is skipped and why, and every old open bill per shop. Writes nothing.
//   run({ by })        does it. Takes a database backup FIRST (refuses to go on if the backup fails, unless backup: false is passed by a script),
//                      marks each moved shop (plan.migration) so a second run moves nobody, clears an old rent pause/grace (so the shop is not stuck
//                      paused by an old bill) and tells the owner. Old open bills stay as they are: keep, waive or void them one by one from the invoice screens.
//   rollback({ by })   puts every shop moved by THIS migration back to "no plan" and restores its old bill state (only shops that have not paid for a plan since).
//
// Kept as they were: amounts, free days and free-period settings, past invoices, credit notes, the shop's own settings.
const Tenant = require('../models/Tenant');
const planService = require('./planService');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');
const { httpError } = require('../middlewares/apiErrors');

const VERSION = 'plans-v1';
const FREE_DAYS = 30;

const baseFilter = { 'plan.id': { $exists: false }, 'plan.migration.version': { $ne: VERSION } };

// the old rent bills are gone, so nobody has open bills
async function openBills() { return new Map(); }

async function preview(now = new Date()) {
    const shops = await Tenant.find(baseFilter).select('name slug status closure.on billing.state brandId plan').lean();
    const bills = await openBills(shops.map((s) => s._id));
    const move = []; const skip = [];
    // a branch of a brand has no plan of its own: it follows the main shop (services/brandPlan.js), so it is not moved by itself
    const Brand = require('../models/Brand');
    const brandPlan = require('./brandPlan');
    const mainOfBrand = new Map();
    for (const id of new Set(shops.filter((x) => x.brandId).map((x) => String(x.brandId)))) { const b = await Brand.findById(id); mainOfBrand.set(id, b ? String(await brandPlan.mainOf(b)) : null); }
    for (const s of shops) {
        const row = { id: String(s._id), name: s.name, slug: s.slug, billState: s.billing?.state || 'free', brand: !!s.brandId, openBills: bills.get(String(s._id)) || null };
        if (s.brandId && mainOfBrand.get(String(s.brandId)) && mainOfBrand.get(String(s.brandId)) !== String(s._id)) skip.push({ ...row, why: 'A branch of a brand. It follows the plan of the main shop.' });
        else if (s.status !== 'active') skip.push({ ...row, why: 'The shop is not active (it is closed or suspended). It is moved when it opens again.' });
        else if (s.closure?.on) skip.push({ ...row, why: 'The shop is closed by the platform.' });
        else move.push(row);
    }
    const endsAt = planService.endOfIstDay(now, FREE_DAYS - 1);
    return {
        version: VERSION, dryRun: true, freeDays: FREE_DAYS, freeUntil: endsAt,
        counts: { move: move.length, skip: skip.length, withOpenBills: move.filter((m) => m.openBills).length, paused: move.filter((m) => m.billState === 'paused').length },
        move, skip,
        note: 'Nothing was changed. Run it to give these shops Pro, free for 30 days. Old open bills stay open.',
    };
}

async function run({ by = 'supreme', now = new Date(), backup = true } = {}) {
    let backupInfo = null;
    if (backup) {
        try { backupInfo = await require('../jobs/backupDump').runBackup(); } catch (e) { throw httpError(409, `The database backup failed, so nothing was moved: ${e.message}`); }
    }
    const pv = await preview(now);
    const endsAt = planService.endOfIstDay(now, FREE_DAYS - 1);
    const moved = [];
    for (const m of pv.move) {
        const t = await Tenant.findOne({ _id: m.id, ...baseFilter }).select('slug billing.state').lean();
        if (!t) continue;   // another run moved it a moment ago
        const prevBill = t.billing?.state || 'free';
        const plan = {
            id: 'pro', startedAt: now, endsAt, freeUntil: endsAt, webEnabled: true, nativeEnabled: true,
            history: [{ at: now, by: `migration (${by})`, from: null, to: 'pro', note: `free ${FREE_DAYS} days` }],
            migration: { version: VERSION, at: now, by, prevBillState: prevBill },
        };
        const set = { plan };
        if (['grace', 'paused'].includes(prevBill)) { set['billing.state'] = 'active'; set['billing.graceEndsAt'] = null; }   // an old unpaid bill no longer pauses the shop
        const r = await Tenant.updateOne({ _id: m.id, ...baseFilter }, { $set: set });
        if (!r.modifiedCount) continue;
        invalidateTenant(t.slug);
        await require('./brandPlan').afterPlanChange(await Tenant.findById(m.id).select('brandId').lean());   // the branches of its brand get the same plan
        moved.push(m.id);
        try {
            require('../notifications/center').notify('plan_changed', {
                tenantId: m.id, title: 'Your shop is now on the Pro plan, free',
                body: `Pro is free for ${FREE_DAYS} days, until ${endsAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}. Open Plan to see what is in it and to choose your plan.`,
                vars: { summary: `Moved to Pro, free for ${FREE_DAYS} days` }, data: { prompt: 'plan' },
            });
        } catch (e) { /* the message is best effort */ }
    }
    return { version: VERSION, dryRun: false, movedCount: moved.length, skipped: pv.skip.length, withOpenBills: pv.counts.withOpenBills, freeUntil: endsAt, backup: backupInfo ? { day: backupInfo.day, collections: backupInfo.collections, documents: backupInfo.documents } : null, moved };
}

// Undo THIS migration for shops that have not bought a plan since (a shop that paid keeps its plan).
async function rollback({ by = 'supreme' } = {}) {
    const shops = await Tenant.find({ 'plan.migration.version': VERSION, 'plan.id': 'pro', 'plan.history.1': { $exists: false } }).select('slug plan').lean();
    let n = 0;
    for (const t of shops) {
        const set = {}; const unset = { plan: 1 };
        const prev = t.plan.migration?.prevBillState;
        if (['grace', 'paused'].includes(prev)) set['billing.state'] = prev;
        const r = await Tenant.updateOne({ _id: t._id, 'plan.migration.version': VERSION }, { $unset: unset, ...(Object.keys(set).length ? { $set: set } : {}) });
        if (r.modifiedCount) { invalidateTenant(t.slug); n += 1; await require('./brandPlan').afterPlanChange(await Tenant.findById(t._id).select('brandId').lean()); }
    }
    return { rolledBack: n, by };
}

module.exports = { preview, run, rollback, VERSION, FREE_DAYS };
