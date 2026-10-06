const Product = require('../models/Product');
const Category = require('../models/Category');
const { foodModeFilter } = require('./catalogQuery');
const { resolveConfig } = require('./tenantConfigService');

const PRODUCT_SELECT = '-tenantId -createdAt -updatedAt -__v';

// Loads products by id with the SAME visibility rules as the menu: active item, active category,
// the shop's food mode, and out-of-stock handling. Used by collections and favourites so a hidden
// item can never leak through a list of ids.
async function loadVisibleProducts(tenant, ids) {
    if (!ids.length) return [];
    const config = resolveConfig(tenant);
    const activeCategoryIds = await Category.find({ tenantId: tenant._id, isActive: true }).distinct('_id');
    const filter = {
        _id: { $in: ids },
        tenantId: tenant._id,
        isActive: true,
        categoryId: { $in: activeCategoryIds },
        ...foodModeFilter(config.home.foodMode),
    };
    if (config.menu.outOfStock === 'hide') filter.isAvailable = true;
    return Product.find(filter).select(PRODUCT_SELECT).lean();
}

module.exports = { loadVisibleProducts, PRODUCT_SELECT };