const O = require('../config/homeOptions');
const { getPreset } = require('../config/homePresets');

const keepAllowed = (list, allowed) =>
    Array.isArray(list) ? list.filter((x) => allowed.includes(x)) : [];

// Use the shop's own list if it has one, otherwise the template's list
const pickList = (stored, preset, allowed) => {
    const clean = keepAllowed(stored, allowed);
    return clean.length ? clean : preset;
};

function resolveHomeConfig(tenant) {
    const raw = tenant.toObject ? tenant.toObject() : tenant;
    const stored = raw.homeConfig || {};
    const preset = getPreset(stored.shopType);

    const foodMode = O.FOOD_MODES.includes(stored.foodMode) ? stored.foodMode : preset.foodMode;

    const storedBlocks = Array.isArray(stored.blocks)
        ? stored.blocks.filter((b) => b && O.BLOCK_TYPES.includes(b.type))
        : [];
    const blocks = (storedBlocks.length ? storedBlocks : preset.blocks)
        .filter((b) => b.enabled !== false)
        .map((b) => b.type);

    let filters = pickList(stored.filters, preset.filters, O.FILTER_IDS);
    if (foodMode === 'mixed' && !filters.includes('veg_only')) filters = ['veg_only', ...filters];
    if (foodMode === 'veg' || foodMode === 'eggless') filters = filters.filter((f) => f !== 'veg_only');

    return {
        shopType: O.SHOP_TYPES.includes(stored.shopType) ? stored.shopType : 'restaurant',
        foodMode,
        showVegDot: foodMode === 'mixed',
        blocks,
        filters,
        sortOptions: pickList(stored.sortOptions, preset.sortOptions, O.SORT_IDS),
        cardStyle: O.CARD_STYLES.includes(stored.cardStyle) ? stored.cardStyle : preset.cardStyle,
        itemOptions: { ...preset.itemOptions, ...(stored.itemOptions || {}) },
    };
}

module.exports = { resolveHomeConfig };