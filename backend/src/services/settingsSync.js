// "Apply to all branches": copy chosen settings groups of ONE branch onto other branches of the same brand.
// Only the groups of how the shop WORKS and LOOKS are copied. Never its map pin and delivery radius, its Razorpay keys, SMS, owners, menu or bills,
// and never what an owner switches by hand every day (accepting orders, pause, busy, auto-accept, hours override): those stay as each branch has them.
const Tenant = require('../models/Tenant');
const { httpError } = require('../middlewares/apiErrors');

const SECTIONS = ['hours', 'orders', 'features', 'menu', 'offers', 'riders', 'home', 'brand', 'notifications', 'app', 'labels'];
const KEEP_OF_TARGET = { orders: ['acceptingOrders', 'pausedUntil', 'busy', 'hoursOverride', 'autoAccept'] };

// returns { applied: [{ tenantId, name, sections }], sections }
async function apply({ brandId, fromTenantId, toTenantIds, sections }) {
    if (!Array.isArray(sections) || !sections.length) throw httpError(400, 'Choose what to copy');
    const bad = sections.filter((s) => !SECTIONS.includes(s));
    if (bad.length) throw httpError(400, `Cannot copy: ${bad.join(', ')}`);
    const from = await Tenant.findOne({ _id: fromTenantId, brandId }).select('name settings').lean();
    if (!from) throw httpError(404, 'The branch to copy from is not part of this brand');
    const targets = await Tenant.find({ _id: { $in: toTenantIds, $ne: from._id }, brandId }).select('name slug settings').lean();
    if (!targets.length) throw httpError(400, 'Choose the other branches');
    const applied = [];
    for (const t of targets) {
        const set = {};
        for (const sec of sections) {
            const src = from.settings?.[sec];
            if (src === undefined) continue;                       // the source never saved this group: nothing to copy
            let next = JSON.parse(JSON.stringify(src));
            for (const k of KEEP_OF_TARGET[sec] || []) {           // what the target's owner switched by hand stays
                if (t.settings?.[sec]?.[k] !== undefined) next[k] = t.settings[sec][k]; else delete next[k];
            }
            set['settings.' + sec] = next;
        }
        if (!Object.keys(set).length) continue;
        await Tenant.updateOne({ _id: t._id }, { $set: set });
        try { require('../middlewares/tenantRecognizer').invalidateTenant(t.slug); } catch (e) { /* the apps catch up on their next request */ }
        applied.push({ tenantId: String(t._id), name: t.name, sections: Object.keys(set).map((k) => k.replace('settings.', '')) });
    }
    return { from: from.name, applied, sections };
}

module.exports = { apply, SECTIONS };
