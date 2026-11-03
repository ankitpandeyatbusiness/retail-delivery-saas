// Multi-branch: coupons, banners and collections (festival strips, combos) go to a new branch with the starting copy, and can be pushed later.
// Like dishes (services/menuSync.js): each branch keeps its OWN, copies of one item share a brandKey (the id of the item they came from).
//   - a coupon's usedCount is never copied or pushed (a branch counts its own uses)
//   - a coupon whose code another coupon of that branch already uses is skipped and reported (a code is unique inside a shop)
//   - a collection takes only the dishes the branch also has (matched by the dish brandKey); the others are left out and counted
const Coupon = require('../models/Coupon');
const Banner = require('../models/Banner');
const Collection = require('../models/Collection');
const Product = require('../models/Product');
const { httpError } = require('../middlewares/apiErrors');

const KINDS = ['coupons', 'banners', 'collections'];
const COUPON_FIELDS = ['code', 'description', 'discountType', 'discountValue', 'maxDiscount', 'minOrder', 'firstOrderOnly', 'dineInOnly', 'usageLimitPerUser', 'totalUsageLimit', 'isPublic', 'startsAt', 'endsAt', 'isActive'];
const BANNER_FIELDS = ['title', 'subtitle', 'image', 'couponCode', 'firstOrderOnly', 'startsAt', 'endsAt', 'sortOrder', 'isActive'];
const COLLECTION_FIELDS = ['kind', 'title', 'subtitle', 'image', 'startsAt', 'endsAt', 'sortOrder', 'isActive'];

const plain = (v) => JSON.parse(JSON.stringify(v));
const take = (src, fields) => Object.fromEntries(fields.filter((k) => src[k] !== undefined && src[k] !== null).map((k) => [k, plain(src[k])]));
const keyOf = async (Model, doc) => {
    if (!doc.brandKey) { await Model.updateOne({ _id: doc._id }, { $set: { brandKey: doc._id } }); doc.brandKey = doc._id; }
    return doc.brandKey;
};
const ended = (d) => !!(d.endsAt && new Date(d.endsAt) < new Date());

// 'created' | 'updated' | 'conflict'
async function giveCoupon(src, to) {
    const key = await keyOf(Coupon, src);
    const data = take(src, COUPON_FIELDS);
    const mine = await Coupon.findOne({ tenantId: to, brandKey: key });
    if (mine) { mine.set(data); await mine.save(); return 'updated'; }
    if (data.isActive !== false && (await Coupon.exists({ tenantId: to, code: String(data.code).toUpperCase(), isActive: true }))) return 'conflict';
    await Coupon.create({ ...data, tenantId: to, brandKey: key, usedCount: 0 });
    return 'created';
}

async function giveBanner(src, to) {
    const key = await keyOf(Banner, src);
    const data = take(src, BANNER_FIELDS);
    const mine = await Banner.findOne({ tenantId: to, brandKey: key });
    if (mine) { mine.set(data); await mine.save(); return 'updated'; }
    await Banner.create({ ...data, tenantId: to, brandKey: key });
    return 'created';
}

// returns { result, left } left = how many of its dishes the branch does not have
async function giveCollection(src, to) {
    const key = await keyOf(Collection, src);
    const dishes = await Product.find({ _id: { $in: src.productIds || [] } }).select('brandKey').lean();
    const keys = dishes.map((d) => d.brandKey).filter(Boolean);
    const there = await Product.find({ tenantId: to, brandKey: { $in: keys } }).select('_id brandKey').lean();
    const byKey = new Map(there.map((p) => [String(p.brandKey), p._id]));
    const productIds = keys.map((k) => byKey.get(String(k))).filter(Boolean);
    const left = (src.productIds || []).length - productIds.length;
    const data = { ...take(src, COLLECTION_FIELDS), productIds };
    const mine = await Collection.findOne({ tenantId: to, brandKey: key });
    if (mine) { mine.set(data); await mine.save(); return { result: 'updated', left }; }
    await Collection.create({ ...data, tenantId: to, brandKey: key });
    return { result: 'created', left };
}

const MODEL = { coupons: Coupon, banners: Banner, collections: Collection };

// Push chosen items of one kind from one branch to others.
async function push({ fromTenantId, kind, ids, toTenantIds }) {
    if (!KINDS.includes(kind)) throw httpError(400, 'kind must be coupons, banners or collections');
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw httpError(400, 'Choose 1 to 100 items');
    if (!toTenantIds.length) throw httpError(400, 'Choose at least one branch');
    const items = await MODEL[kind].find({ _id: { $in: ids }, tenantId: fromTenantId });
    if (items.length !== new Set(ids.map(String)).size) throw httpError(404, 'A chosen item is not on this branch');
    const out = { kind, created: 0, updated: 0, conflicts: 0, dishesLeftOut: 0, branches: toTenantIds.length, items: items.length };
    for (const to of toTenantIds) {
        for (const it of items) {
            if (kind === 'coupons') { const r = await giveCoupon(it, to); if (r === 'conflict') out.conflicts += 1; else out[r] += 1; }
            else if (kind === 'banners') { out[await giveBanner(it, to)] += 1; }
            else { const r = await giveCollection(it, to); out[r.result] += 1; out.dishesLeftOut += r.left; }
        }
    }
    return out;
}

// the starting copy for a new branch: what is switched on and not over yet (dishes must be copied first, for the collections)
async function copyExtras({ fromTenantId, toTenantId }) {
    const [coupons, banners, collections] = await Promise.all([
        Coupon.find({ tenantId: fromTenantId, isActive: true }), Banner.find({ tenantId: fromTenantId, isActive: true }), Collection.find({ tenantId: fromTenantId, isActive: true }),
    ]);
    const out = { coupons: 0, banners: 0, collections: 0, conflicts: 0 };
    for (const c of coupons.filter((x) => !ended(x))) { const r = await giveCoupon(c, toTenantId); if (r === 'created') out.coupons += 1; else if (r === 'conflict') out.conflicts += 1; }
    for (const b of banners.filter((x) => !ended(x))) { if ((await giveBanner(b, toTenantId)) === 'created') out.banners += 1; }
    for (const c of collections.filter((x) => !ended(x))) { if ((await giveCollection(c, toTenantId)).result === 'created') out.collections += 1; }
    return out;
}

module.exports = { push, copyExtras, KINDS };
