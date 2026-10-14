// Checks and completes what a shop typed for an item: its kind, how it is sold, and its menu category.
// Used by both product routes (the owner's and the superadmin's). Mutates `d` (a new item's data).
const Category = require('../models/Category');
const { typeOf, kindOf } = require('../config/businessTypes');
const { validateMeasureInput } = require('./itemMeasure');
const { httpError } = require('../middlewares/apiErrors');

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

    // no category chosen: file it under its kind's category, creating that category the first time
    if (!d.categoryId && kind) {
        const name = kind.category;
        let cat = await Category.findOne({ tenantId: tenant._id, name: new RegExp(`^${name}$`, 'i') }).select('_id').lean();
        if (!cat) cat = await Category.create({ tenantId: tenant._id, name });
        d.categoryId = cat._id;
    }
}

module.exports = { applyItemRules };
