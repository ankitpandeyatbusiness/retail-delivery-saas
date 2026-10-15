// Checks and completes what a shop typed for an item: its kind, how it is sold, and its menu category.
// Used by both product routes (the owner's and the superadmin's). Mutates `d` (a new item's data).
const Category = require('../models/Category');
const { typeOf, kindOf } = require('../config/businessTypes');
const { validateMeasureInput } = require('./itemMeasure');
const { httpError } = require('../middlewares/apiErrors');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "south  indian" -> "South Indian". Short all-capital words (BBQ, KFC) are left as they are.
const titleCase = (s) =>
    String(s).trim().replace(/\s+/g, ' ').split(' ')
        .map((w) => (w.length <= 3 && /[A-Z]/.test(w) && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(' ');

// The owner typed a new category name in the item form: reuse the shop's category of that name (any
// capitalisation), or create it. A category that was removed (switched off) comes back when it is typed again.
async function categoryByName(tenant, typed) {
    const name = titleCase(typed);
    if (name.length < 2 || name.length > 40) throw httpError(400, 'A category name is 2 to 40 letters');
    const found = await Category.findOne({ tenantId: tenant._id, name: new RegExp(`^${escapeRegex(name)}$`, 'i') })
        .sort({ isActive: -1, _id: 1 });
    if (found) {
        if (found.isActive === false) { found.isActive = true; await found.save(); }
        return found._id;
    }
    return (await Category.create({ tenantId: tenant._id, name }))._id;
}

async function applyItemRules(d, tenant) {
    const bt = tenant.businessType || 'restaurant';
    const type = typeOf(bt);
    if (type.status !== 'active') throw httpError(400, `${type.label} shops are not open yet`);

    let kind = null;
    if (d.itemKind) {
        kind = kindOf(bt, d.itemKind);
        if (!kind) throw httpError(400, `Unknown item kind "${d.itemKind}"`);
    }
    // a new item that only says "Sweet" starts being sold the way a sweet usually is
    if (kind && !d.sellBy) d.sellBy = kind.sellBy;
    const errors = validateMeasureInput(d, bt);
    if (errors.length) throw httpError(400, errors[0]);

    // a typed category name wins over everything else
    if (d.categoryName !== undefined) {
        const typed = String(d.categoryName || '').trim();
        delete d.categoryName;
        if (typed) d.categoryId = await categoryByName(tenant, typed);
    }

    // no category chosen: file it under its kind's category, creating that category the first time
    if (!d.categoryId && kind) {
        const name = kind.category;
        let cat = await Category.findOne({ tenantId: tenant._id, name: new RegExp(`^${name}$`, 'i') }).select('_id').lean();
        if (!cat) cat = await Category.create({ tenantId: tenant._id, name });
        d.categoryId = cat._id;
    }
}

module.exports = { applyItemRules, titleCase };
