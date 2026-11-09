// A brand has ONE plan, set on its MAIN shop. Every branch carries a copy (plan.inheritedFrom = the main shop), so every existing check of tenant.plan
// keeps working untouched. The copy is rewritten whenever the main shop's plan changes (set by the supreme admin, paid by the owner, the end of a term).
//
// Shops of a brand ("locations"): 1 main + the branches. A brand has 3 free (main + 2 branches, the platform default includedBranches = 2, editable PER BRAND by the
// supreme admin), then each extra one is a paid add-on (Rs 1,499 a month + GST, platform setting) the brand owner pays BEFORE the branch is created, or a free one the
// supreme admin allows (freeExtra, audit logged).
const Brand = require('../models/Brand');
const Tenant = require('../models/Tenant');
const planService = require('./planService');
const { invalidateTenant } = require('../middlewares/tenantRecognizer');

const COPIED = ['id', 'startedAt', 'endsAt', 'freeUntil', 'extras', 'scheduled', 'paused'];   // what a branch takes from the main shop

// the main shop of a brand: the one chosen, else the oldest branch (remembered from then on)
async function mainOf(brand) {
    if (brand.mainTenantId && (await Tenant.exists({ _id: brand.mainTenantId, brandId: brand._id }))) return brand.mainTenantId;
    const first = await Tenant.findOne({ brandId: brand._id }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
    if (!first) return null;
    await Brand.updateOne({ _id: brand._id }, { $set: { mainTenantId: first._id } });
    brand.mainTenantId = first._id;
    return first._id;
}

async function capacity(brand, def) {
    def = def || await planService.getDefaults();
    const included = Number.isInteger(brand.locations?.includedBranches) ? brand.locations.includedBranches : def.includedBranches;
    const paid = brand.locations?.paidExtra || 0;
    const free = brand.locations?.freeExtra || 0;
    const used = await Tenant.countDocuments({ brandId: brand._id });
    return { includedBranches: included, includedLocations: 1 + included, paidExtra: paid, freeExtra: free, capacity: 1 + included + paid + free, used, addonPaise: def.branchAddonPaise };
}

// a new branch needs a free place: refused (with what to do) when the brand has used every shop it has
async function assertRoomForBranch(brand) {
    const c = await capacity(brand);
    if (c.used + 1 > c.capacity) {
        throw Object.assign(new Error(`This brand has used all its ${c.capacity} shops. The brand owner pays for an extra shop first (Rs ${(c.addonPaise / 100).toFixed(0)} a month + GST), or you can allow one free.`), { status: 409, extra: { needsPayment: true, ...c } });
    }
    return c;
}

// copy the main shop's plan to every branch (keeps each branch's own website / app switches)
async function syncPlan(brandId) {
    const brand = await Brand.findById(brandId);
    if (!brand) return { synced: 0 };
    const mainId = await mainOf(brand);
    if (!mainId) return { synced: 0 };
    const main = await Tenant.findById(mainId).select('plan slug').lean();
    const mp = main?.plan;
    const branches = await Tenant.find({ brandId, _id: { $ne: mainId } }).select('slug plan').lean();
    let n = 0;
    for (const b of branches) {
        const own = b.plan || {};
        const plan = mp?.id ? { webEnabled: own.webEnabled, nativeEnabled: own.nativeEnabled, inheritedFrom: mainId } : undefined;
        if (plan) for (const k of COPIED) if (mp[k] !== undefined) plan[k] = mp[k];
        if (plan) { for (const k of Object.keys(plan)) if (plan[k] === undefined) delete plan[k]; }
        const r = await Tenant.updateOne({ _id: b._id }, plan ? { $set: { plan } } : { $unset: { plan: 1 } });
        if (r.modifiedCount) { invalidateTenant(b.slug); n += 1; }
    }
    return { synced: n, main: String(mainId) };
}

// after any change of a shop's plan: a main shop pushes it to its branches. (A branch's own plan is never edited: planService refuses, see guard.)
async function afterPlanChange(tenant) {
    if (!tenant?.brandId) return;
    const brand = await Brand.findById(tenant.brandId);
    if (!brand) return;
    const mainId = await mainOf(brand);
    if (String(mainId) === String(tenant._id)) await syncPlan(tenant.brandId);
}

// the plan lives on the main shop: asking to change a branch's plan is refused with the name of the main shop
async function guardBranch(tenant) {
    if (!tenant?.brandId) return;
    const brand = await Brand.findById(tenant.brandId).select('name mainTenantId').lean();
    if (!brand) return;
    const mainId = await mainOf(Object.assign(new Brand(), brand, { _id: tenant.brandId }));
    if (mainId && String(mainId) !== String(tenant._id)) {
        const main = await Tenant.findById(mainId).select('name').lean();
        throw Object.assign(new Error(`This shop is a branch of ${brand.name}. The plan is set on the main shop (${main?.name || 'the first shop'}) and the branches follow it.`), { status: 409 });
    }
}

// the brand's picture for the superadmin and the owner: the main shop, its plan, the shops used
async function summary(brand) {
    const mainId = await mainOf(brand);
    const [c, main] = await Promise.all([capacity(brand), mainId ? Tenant.findById(mainId).select('name slug plan').lean() : null]);
    return { main: main ? { id: String(main._id), name: main.name, slug: main.slug } : null, plan: main ? planService.viewOf(main) : null, locations: c };
}

// The shop whose plan is billed: a branch's owner pays on the MAIN shop (the plan lives there). Returns the main shop's document (lean) or the shop itself.
async function planTenant(tenant) {
    if (!tenant?.brandId) return tenant;
    const brand = await Brand.findById(tenant.brandId);
    if (!brand) return tenant;
    const mainId = await mainOf(brand);
    if (!mainId || String(mainId) === String(tenant._id)) return tenant;
    return (await Tenant.findById(mainId).select('_id slug name phone address business plan brandId androidPackage').lean()) || tenant;
}

// the shops beyond the free ones that a renewal bills (a branch that was removed stops being billed at the next renewal): used - (1 + free branches) - free extras
async function billableExtra(tenant) {
    if (!tenant?.brandId) return { extra: 0, addonPaise: 0 };
    const brand = await Brand.findById(tenant.brandId);
    if (!brand) return { extra: 0, addonPaise: 0 };
    const c = await capacity(brand);
    return { extra: Math.max(0, c.used - c.includedLocations - c.freeExtra), addonPaise: c.addonPaise };
}

module.exports = { planTenant, billableExtra, mainOf, capacity, assertRoomForBranch, syncPlan, afterPlanChange, guardBranch, summary };
