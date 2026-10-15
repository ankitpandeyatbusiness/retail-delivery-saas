// Everything about a shop's `settings` document that is not drawing:
//   - human names for the option ids the backend sends (/admin/options)
//   - what a shop's settings EFFECTIVELY are (saved values, then defaults)
//   - how to put a change back into the whole document (the backend replaces `settings` as one piece)
import { titleCase } from './format';

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// plain objects merge deeply; lists, numbers and text replace (same rule as the backend)
export const deepMerge = (base, over) => {
    if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
};

/* ---------------------------------- names ---------------------------------- */
export const NAMES = {
    foodMode: { veg: 'Pure veg', nonveg: 'Non-veg', mixed: 'Veg + non-veg', eggless: 'Eggless' },
    block: {
        search: 'Search bar', banner: 'Banners', categories: 'Categories', filters: 'Filter chips', offers: 'Offers strip',
        bestsellers: 'Bestsellers', festival: 'Festival specials', combos: 'Combos', new_arrivals: 'New arrivals', items: 'All items',
    },
    filter: {
        veg_only: 'Veg only', egg_free: 'Egg free', rating_4: '4★ and above', price_range: 'Price range', offers: 'Offers',
        bestseller: 'Bestseller', spice_level: 'Spice level', sugar_free: 'Sugar free', jain: 'Jain', weight: 'Weight',
        serves: 'Serves', gift_pack: 'Gift pack', new: 'New',
    },
    sort: {
        popularity: 'Popularity', price_low: 'Price: low to high', price_high: 'Price: high to low',
        rating: 'Rating', prep_time: 'Prep time', newest: 'Newest',
    },
    cardStyle: { big: 'Big cards', compact: 'Compact', grid: 'Grid' },
    font: { modern: 'Modern', classic: 'Classic', rounded: 'Rounded' },
    shape: { rounded: 'Rounded', pill: 'Pill', square: 'Square' },
    look: { bold: 'Bold (brand header)', fresh: 'Fresh (light)', cream: 'Cream (warm)', midnight: 'Midnight (dark)' },
    motion: { full: 'Full', subtle: 'Subtle', off: 'Off' },
    headerStyle: { hero: 'Big shop header', compact: 'Compact header' },
    tabBarStyle: { classic: 'Classic strip', floating: 'Floating bar' },
    categoryStyle: { circles: 'Circles', tiles: 'Photo tiles', pills: 'Pills' },
    tab: { home: 'Home', search: 'Search', offers: 'Offers', orders: 'Orders', profile: 'Profile' },
    orderType: { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' },
    payment: { cod: 'Cash on delivery', online: 'Online payment' },
    fee: { free: 'Free', flat: 'Flat fee', free_above: 'Free above an amount', distance: 'By distance' },
    gst: { none: 'No GST', inclusive: 'Included in prices', exclusive: 'Added on top' },
    assign: { automatic: 'Automatic', manual: 'Manual' },
    language: { en: 'English', hi: 'Hindi' },
    outOfStock: { dim: 'Show dimmed', hide: 'Hide item' },
    day: { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' },
    label: {
        addButton: 'Add button', orderButton: 'Place-order button', emptyCart: 'Empty cart message',
        emptySearch: 'No results message', closedMessage: 'Closed message',
    },
    itemOption: { sizes: 'Sizes', addOns: 'Add-ons', spiceLevel: 'Spice level', weightOptions: 'Weight options' },
};
export const nameOf = (group, id) => NAMES[group]?.[id] || titleCase(id);
export const choices = (group, ids = []) => ids.map((id) => ({ value: id, label: nameOf(group, id) }));

// what each on/off feature does, in plain words
export const FEATURES = {
    vegToggle: ['Veg-only switch', 'A switch on the home screen to show only veg dishes'],
    vegDot: ['Veg / non-veg dot', 'Green and red dot on every dish card'],
    ratingBadge: ['Rating badge', 'Star rating on dish cards'],
    prepTime: ['Preparation time', 'Shows how long a dish takes'],
    serves: ['Serves', 'Shows how many people a dish serves'],
    calories: ['Calories', 'Shows calories on the dish page'],
    specialInstructions: ['Special instructions', 'A note box on the dish and in the cart'],
    scheduleOrder: ['Schedule an order', 'Customers can order for later'],
    reorder: ['Reorder', 'One-tap order again from past orders'],
    favourites: ['Favourites', 'Customers can save dishes'],
    guestBrowsing: ['Browse without login', 'A Skip button on the customer login'],
    couponField: ['Coupon box', 'A coupon code field in the cart'],
    tips: ['Tips', 'Customers can tip the rider'],
};
export const FEATURE_GROUPS = [
    { title: 'Food labels', keys: ['vegToggle', 'vegDot'] },
    { title: 'Dish information', keys: ['ratingBadge', 'prepTime', 'serves', 'calories'] },
    { title: 'Ordering', keys: ['specialInstructions', 'scheduleOrder', 'reorder', 'tips', 'couponField'] },
    { title: 'Customers', keys: ['favourites', 'guestBrowsing'] },
];

/* ------------------------------ effective values ------------------------------ */
// A list of every block, in the shop's order, with the unused ones at the end switched off
export const fullBlockList = (stored, allTypes) => {
    const seen = new Set();
    const out = [];
    for (const b of Array.isArray(stored) ? stored : []) {
        if (b && allTypes.includes(b.type) && !seen.has(b.type)) { seen.add(b.type); out.push({ type: b.type, enabled: b.enabled !== false }); }
    }
    for (const t of allTypes) if (!seen.has(t)) out.push({ type: t, enabled: false });
    return out;
};

export function effectiveSettings({ tenant, resolved, options, defaults, presets }) {
    const raw = tenant.settings || {};
    const O = options || {};
    const D = defaults || {};
    const shopType = raw.home?.shopType || resolved?.home?.shopType || 'restaurant';
    const preset = (presets || {})[shopType] || (presets || {}).restaurant || {};

    const orders = deepMerge(D.orders || {}, raw.orders || {});
    if (raw.orders?.minOrder === undefined && tenant.delivery?.minOrder) orders.minOrder = tenant.delivery.minOrder;

    return {
        brand: {
            colors: { ...(resolved?.brand?.colors || {}) },
            fontStyle: raw.brand?.fontStyle || D.brand?.fontStyle || 'modern',
            buttonShape: raw.brand?.buttonShape || D.brand?.buttonShape || 'rounded',
            look: raw.brand?.look || D.brand?.look || 'bold',
            motion: raw.brand?.motion || D.brand?.motion || 'full',
            headerStyle: raw.brand?.headerStyle || D.brand?.headerStyle || 'hero',
            tabBarStyle: raw.brand?.tabBarStyle || D.brand?.tabBarStyle || 'classic',
            categoryStyle: raw.brand?.categoryStyle || D.brand?.categoryStyle || 'circles',
        },
        tabs: raw.tabs || D.tabs || ['home', 'search', 'orders', 'profile'],
        home: {
            shopType,
            foodMode: resolved?.home?.foodMode || preset.foodMode || 'mixed',
            blocks: fullBlockList(raw.home?.blocks || preset.blocks, O.BLOCK_TYPES || []),
            filters: raw.home?.filters ?? preset.filters ?? [],
            sortOptions: raw.home?.sortOptions ?? preset.sortOptions ?? [],
            cardStyle: resolved?.home?.cardStyle || preset.cardStyle || 'big',
            itemOptions: { sizes: false, addOns: false, spiceLevel: false, weightOptions: false, ...(preset.itemOptions || {}), ...(raw.home?.itemOptions || {}) },
        },
        features: { ...(D.features || {}), ...(resolved?.features || {}) },
        menu: deepMerge(D.menu || {}, raw.menu || {}),
        orders,
        hours: {
            weekly: clone(raw.hours?.weekly) || {},
            closedMessage: raw.hours?.closedMessage || '',
            closedDates: clone(raw.hours?.closedDates) || [],
        },
        offers: deepMerge(D.offers || {}, raw.offers || {}),
        riders: deepMerge(D.riders || {}, raw.riders || {}),
        labels: deepMerge(D.labels || {}, raw.labels || {}),
        app: { minVersion: raw.app?.minVersion || '' },
        notifications: deepMerge(D.notifications || {}, raw.notifications || {}),
    };
}

// The whole `settings` document to send: the saved one, with the changed keys of each touched section put in.
// patches: { orders: { minOrder: 100 }, tabs: ['home', 'orders'] }
export function buildSettings(saved, patches) {
    const out = { ...(clone(saved) || {}) };
    for (const [section, patch] of Object.entries(patches)) {
        if (isObj(patch)) out[section] = { ...(isObj(out[section]) ? out[section] : {}), ...clone(patch) };
        else out[section] = clone(patch);   // tabs is a plain list
    }
    return out;
}

/* ------------------------------ small helpers ------------------------------ */
export const numOrNull = (text) => {
    const t = String(text).trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

export const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '');
