const blocks = (...types) => types.map((type) => ({ type, enabled: true }));

const PRESETS = {
    restaurant: {
        foodMode: 'mixed',
        blocks: blocks('search', 'banner', 'categories', 'filters', 'offers', 'bestsellers', 'items'),
        filters: ['veg_only', 'rating_4', 'price_range', 'offers', 'bestseller'],
        sortOptions: ['popularity', 'price_low', 'price_high', 'rating'],
        cardStyle: 'big',
        itemOptions: { sizes: true, addOns: true, spiceLevel: true, weightOptions: false },
    },
    sweet_shop: {
        foodMode: 'veg',
        blocks: blocks('search', 'banner', 'categories', 'festival', 'filters', 'offers', 'bestsellers', 'items'),
        filters: ['sugar_free', 'weight', 'gift_pack', 'bestseller', 'price_range'],
        sortOptions: ['popularity', 'price_low', 'price_high', 'newest'],
        cardStyle: 'grid',
        itemOptions: { sizes: false, addOns: false, spiceLevel: false, weightOptions: true },
    },
    bakery: {
        foodMode: 'eggless',
        blocks: blocks('search', 'banner', 'categories', 'filters', 'offers', 'new_arrivals', 'items'),
        filters: ['egg_free', 'price_range', 'bestseller', 'serves', 'new'],
        sortOptions: ['popularity', 'price_low', 'price_high', 'newest'],
        cardStyle: 'big',
        itemOptions: { sizes: true, addOns: true, spiceLevel: false, weightOptions: true },
    },
    juice_bar: {
        foodMode: 'veg',
        blocks: blocks('search', 'banner', 'categories', 'filters', 'offers', 'bestsellers', 'items'),
        filters: ['sugar_free', 'price_range', 'bestseller', 'offers'],
        sortOptions: ['popularity', 'price_low', 'price_high'],
        cardStyle: 'compact',
        itemOptions: { sizes: true, addOns: true, spiceLevel: false, weightOptions: false },
    },
};

// Shop types without their own template start from the closest one
const PRESET_FALLBACK = {
    dessert: 'bakery',
    dry_fruits_chocolates: 'sweet_shop',
    tea_coffee: 'juice_bar',
};

const getPreset = (shopType) =>
    PRESETS[shopType] || PRESETS[PRESET_FALLBACK[shopType]] || PRESETS.restaurant;

module.exports = { getPreset };