const O = require('../config/tenantOptions');
const { resolveHomeConfig } = require('./homeConfigService');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------ VALIDATOR ------------------------------ */
// Returns { ok, errors, clean }. `clean` only contains valid, known fields.
function validateSettings(input) {
    const s = isObj(input) ? input : {};
    const errors = [];
    const clean = {};
    const err = (path, msg) => errors.push(`${path}: ${msg}`);

    const known = (obj, keys, path) =>
        Object.keys(obj).forEach((k) => { if (!keys.includes(k)) err(`${path}.${k}`, 'unknown field'); });

    const oneOf = (path, v, list) => {
        if (list.includes(v)) return true;
        err(path, `must be one of: ${list.join(', ')}`);
        return false;
    };
    const bool = (path, v) => {
        if (typeof v === 'boolean') return true;
        err(path, 'must be true or false');
        return false;
    };
    const num = (path, v, min, max) => {
        if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return true;
        err(path, `must be a number between ${min} and ${max}`);
        return false;
    };
    const str = (path, v, max) => {
        if (typeof v === 'string' && v.trim().length <= max) return true;
        err(path, `must be text up to ${max} characters`);
        return false;
    };
    const listOf = (path, v, allowed, min = 0, max = 99) => {
        if (!Array.isArray(v)) { err(path, 'must be a list'); return null; }
        const uniq = [...new Set(v)];
        const bad = uniq.filter((x) => !allowed.includes(x));
        if (bad.length) { err(path, `unknown values: ${bad.join(', ')}`); return null; }
        if (uniq.length < min || uniq.length > max) { err(path, `needs ${min} to ${max} items`); return null; }
        return uniq;
    };
    // run fn for a section object, store result in clean[name]
    const section = (name, keys, fn) => {
        if (s[name] === undefined) return;
        if (!isObj(s[name])) return err(name, 'must be an object');
        known(s[name], keys, name);
        const out = {};
        fn(s[name], out, (k) => `${name}.${k}`);
        clean[name] = out;
    };

    known(s, ['brand', 'tabs', 'home', 'features', 'menu', 'orders', 'hours', 'offers', 'labels'], 'settings');

    // brand
    section('brand', ['colors', 'fontStyle', 'buttonShape'], (b, out, p) => {
        if (b.colors !== undefined) {
            if (!isObj(b.colors)) err(p('colors'), 'must be an object');
            else {
                out.colors = {};
                for (const [k, v] of Object.entries(b.colors)) {
                    if (!O.COLOR_KEYS.includes(k)) err(p(`colors.${k}`), 'unknown color');
                    else if (!HEX.test(v)) err(p(`colors.${k}`), 'must look like #RRGGBB');
                    else out.colors[k] = v;
                }
            }
        }
        if (b.fontStyle !== undefined && oneOf(p('fontStyle'), b.fontStyle, O.FONT_STYLES)) out.fontStyle = b.fontStyle;
        if (b.buttonShape !== undefined && oneOf(p('buttonShape'), b.buttonShape, O.BUTTON_SHAPES)) out.buttonShape = b.buttonShape;
    });

    // tabs (ordered list)
    if (s.tabs !== undefined) {
        const t = listOf('tabs', s.tabs, O.TABS, 2, 5);
        if (t) {
            if (!t.includes('home')) err('tabs', 'must include home');
            else clean.tabs = t;
        }
    }

    // home
    section('home', ['shopType', 'foodMode', 'blocks', 'filters', 'sortOptions', 'cardStyle', 'itemOptions'], (h, out, p) => {
        if (h.shopType !== undefined && oneOf(p('shopType'), h.shopType, O.SHOP_TYPES)) out.shopType = h.shopType;
        if (h.foodMode !== undefined && oneOf(p('foodMode'), h.foodMode, O.FOOD_MODES)) out.foodMode = h.foodMode;
        if (h.cardStyle !== undefined && oneOf(p('cardStyle'), h.cardStyle, O.CARD_STYLES)) out.cardStyle = h.cardStyle;
        if (h.filters !== undefined) { const f = listOf(p('filters'), h.filters, O.FILTER_IDS, 0, 12); if (f) out.filters = f; }
        if (h.sortOptions !== undefined) { const f = listOf(p('sortOptions'), h.sortOptions, O.SORT_IDS, 1, 6); if (f) out.sortOptions = f; }
        if (h.blocks !== undefined) {
            if (!Array.isArray(h.blocks)) err(p('blocks'), 'must be a list');
            else {
                const blocks = [];
                h.blocks.forEach((b, i) => {
                    if (!isObj(b) || !O.BLOCK_TYPES.includes(b.type)) return err(p(`blocks[${i}]`), 'needs a valid type');
                    blocks.push({ type: b.type, enabled: b.enabled !== false });
                });
                if (!blocks.some((b) => b.type === 'items' && b.enabled)) err(p('blocks'), 'must include the "items" block enabled');
                else out.blocks = blocks;
            }
        }
        if (h.itemOptions !== undefined) {
            if (!isObj(h.itemOptions)) err(p('itemOptions'), 'must be an object');
            else {
                out.itemOptions = {};
                for (const [k, v] of Object.entries(h.itemOptions)) {
                    if (!['sizes', 'addOns', 'spiceLevel', 'weightOptions'].includes(k)) err(p(`itemOptions.${k}`), 'unknown');
                    else if (bool(p(`itemOptions.${k}`), v)) out.itemOptions[k] = v;
                }
            }
        }
    });

    // features
    section('features', O.FEATURE_KEYS, (f, out, p) => {
        for (const k of O.FEATURE_KEYS) if (f[k] !== undefined && bool(p(k), f[k])) out[k] = f[k];
    });

    // menu
    section('menu', ['outOfStock', 'groupByCategory'], (m, out, p) => {
        if (m.outOfStock !== undefined && oneOf(p('outOfStock'), m.outOfStock, O.OUT_OF_STOCK)) out.outOfStock = m.outOfStock;
        if (m.groupByCategory !== undefined && bool(p('groupByCategory'), m.groupByCategory)) out.groupByCategory = m.groupByCategory;
    });

    // orders
    section('orders',
        ['types', 'payments', 'minOrder', 'deliveryFee', 'packagingCharge', 'gst', 'tipOptions', 'prepTimeMin', 'acceptingOrders'],
        (o, out, p) => {
            if (o.types !== undefined) { const v = listOf(p('types'), o.types, O.ORDER_TYPES, 1, 3); if (v) out.types = v; }
            if (o.payments !== undefined) { const v = listOf(p('payments'), o.payments, O.PAYMENT_METHODS, 1, 4); if (v) out.payments = v; }
            if (o.minOrder !== undefined && num(p('minOrder'), o.minOrder, 0, 5000)) out.minOrder = o.minOrder;
            if (o.packagingCharge !== undefined && num(p('packagingCharge'), o.packagingCharge, 0, 500)) out.packagingCharge = o.packagingCharge;
            if (o.prepTimeMin !== undefined && num(p('prepTimeMin'), o.prepTimeMin, 0, 240)) out.prepTimeMin = o.prepTimeMin;
            if (o.acceptingOrders !== undefined && bool(p('acceptingOrders'), o.acceptingOrders)) out.acceptingOrders = o.acceptingOrders;
            if (o.deliveryFee !== undefined) {
                const d = o.deliveryFee;
                if (!isObj(d)) err(p('deliveryFee'), 'must be an object');
                else {
                    known(d, ['type', 'amount', 'freeAbove'], p('deliveryFee'));
                    out.deliveryFee = {};
                    if (d.type !== undefined && oneOf(p('deliveryFee.type'), d.type, O.FEE_TYPES)) out.deliveryFee.type = d.type;
                    if (d.amount !== undefined && num(p('deliveryFee.amount'), d.amount, 0, 1000)) out.deliveryFee.amount = d.amount;
                    if (d.freeAbove !== undefined && num(p('deliveryFee.freeAbove'), d.freeAbove, 0, 100000)) out.deliveryFee.freeAbove = d.freeAbove;
                }
            }
            if (o.gst !== undefined) {
                const g = o.gst;
                if (!isObj(g)) err(p('gst'), 'must be an object');
                else {
                    known(g, ['mode', 'percent'], p('gst'));
                    out.gst = {};
                    if (g.mode !== undefined && oneOf(p('gst.mode'), g.mode, O.GST_MODES)) out.gst.mode = g.mode;
                    if (g.percent !== undefined && num(p('gst.percent'), g.percent, 0, 28)) out.gst.percent = g.percent;
                }
            }
            if (o.tipOptions !== undefined) {
                if (!Array.isArray(o.tipOptions) || o.tipOptions.length > 5) err(p('tipOptions'), 'must be a list of up to 5 amounts');
                else if (o.tipOptions.every((n, i) => num(p(`tipOptions[${i}]`), n, 0, 500))) out.tipOptions = o.tipOptions;
            }
        });

    // hours
    section('hours', ['weekly', 'closedMessage'], (h, out, p) => {
        if (h.closedMessage !== undefined && str(p('closedMessage'), h.closedMessage, 120)) out.closedMessage = h.closedMessage.trim();
        if (h.weekly !== undefined) {
            if (!isObj(h.weekly)) return err(p('weekly'), 'must be an object like { mon: [{open, close}] }');
            out.weekly = {};
            for (const [day, slots] of Object.entries(h.weekly)) {
                if (!O.DAYS.includes(day)) { err(p(`weekly.${day}`), 'unknown day'); continue; }
                if (!Array.isArray(slots) || slots.length > 3) { err(p(`weekly.${day}`), 'must be a list of up to 3 slots (empty = closed)'); continue; }
                const ok = slots.every((x) => isObj(x) && TIME.test(x.open) && TIME.test(x.close));
                if (!ok) err(p(`weekly.${day}`), 'each slot needs open/close as HH:MM');
                else out.weekly[day] = slots.map((x) => ({ open: x.open, close: x.close }));
            }
        }
    });

    // offers
    section('offers', ['couponsEnabled', 'showOnHome', 'showInCart'], (o, out, p) => {
        for (const k of ['couponsEnabled', 'showOnHome', 'showInCart']) if (o[k] !== undefined && bool(p(k), o[k])) out[k] = o[k];
    });

    // labels
    section('labels', ['language', ...O.LABEL_KEYS], (l, out, p) => {
        if (l.language !== undefined && oneOf(p('language'), l.language, O.LANGUAGES)) out.language = l.language;
        for (const k of O.LABEL_KEYS) if (l[k] !== undefined && str(p(k), l[k], 60)) out[k] = l[k].trim();
    });

    return { ok: errors.length === 0, errors, clean };
}

/* ------------------------------ DEFAULTS ------------------------------ */
const DEFAULTS = {
    brand: { fontStyle: 'modern', buttonShape: 'rounded' },
    tabs: ['home', 'search', 'orders', 'profile'],
    features: {
        ratingBadge: true, prepTime: true, serves: false, calories: false,
        specialInstructions: true, scheduleOrder: false, reorder: true, favourites: false,
        guestBrowsing: true, couponField: true, tips: false,
    },
    menu: { outOfStock: 'dim', groupByCategory: true },
    orders: {
        types: ['delivery'], payments: ['cod'], minOrder: 0,
        deliveryFee: { type: 'free', amount: 0, freeAbove: 0 },
        packagingCharge: 0, gst: { mode: 'none', percent: 0 },
        tipOptions: [], prepTimeMin: 20, acceptingOrders: true,
    },
    offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
    labels: {
        language: 'en', addButton: 'Add', orderButton: 'Place order',
        emptyCart: 'Your cart is empty', emptySearch: 'No dishes found',
        closedMessage: 'We are closed right now',
    },
};

// plain objects merge deeply, everything else (lists, numbers, text) replaces
const merge = (base, over) => {
    if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
    return out;
};

/* ------------------------------ OPEN / CLOSED ------------------------------ */
const toMin = (t) => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m); };

// India time (IST, UTC+5:30). No hours configured = always open.
function openStatus(weekly, acceptingOrders, now = new Date()) {
    if (acceptingOrders === false) return { isOpen: false, reason: 'paused' };
    if (!weekly || !Object.keys(weekly).length) return { isOpen: true, reason: null };

    const ist = new Date(now.getTime() + 330 * 60000);
    const day = ist.getUTCDay();
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();

    const today = (weekly[O.DAYS[day]] || []).some((w) => {
        const o = toMin(w.open), c = toMin(w.close);
        return c > o ? mins >= o && mins < c : mins >= o;           // close <= open means past midnight
    });
    const spill = (weekly[O.DAYS[(day + 6) % 7]] || []).some((w) => {
        const o = toMin(w.open), c = toMin(w.close);
        return c <= o && mins < c;                                  // yesterday's late-night slot still running
    });
    return today || spill ? { isOpen: true, reason: null } : { isOpen: false, reason: 'outside_hours' };
}

/* ------------------------------ RESOLVER ------------------------------ */
// Turns a raw tenant document into the one config the app uses. Never throws on bad data:
// invalid parts are dropped and defaults fill the gaps.
function resolveConfig(tenant, now = new Date()) {
    const { clean } = validateSettings(tenant.settings);

    const legacy = tenant.homeConfig || {};
    const home = resolveHomeConfig({ ...tenant, homeConfig: { ...legacy, ...(clean.home || {}) } });
    if (Array.isArray(clean.home?.filters)) home.filters = clean.home.filters; // explicit [] is respected

    const brand = {
        colors: { ...(tenant.colors || {}), ...(clean.brand?.colors || {}) },
        fontStyle: clean.brand?.fontStyle || DEFAULTS.brand.fontStyle,
        buttonShape: clean.brand?.buttonShape || DEFAULTS.brand.buttonShape,
    };

    const features = merge(DEFAULTS.features, clean.features);
    if (features.vegToggle === undefined) features.vegToggle = home.foodMode === 'mixed';
    if (features.vegDot === undefined) features.vegDot = home.showVegDot;
    home.showVegDot = features.vegDot;

    const offers = merge(DEFAULTS.offers, clean.offers);
    let tabs = clean.tabs || DEFAULTS.tabs;
    if (!offers.couponsEnabled) tabs = tabs.filter((t) => t !== 'offers');

    const orders = merge(DEFAULTS.orders, clean.orders);
    if (clean.orders?.minOrder === undefined && tenant.delivery?.minOrder) orders.minOrder = tenant.delivery.minOrder;
    if (tenant.ownerBlocked) orders.acceptingOrders = false;

    // Illegal Tax Fix: Force GST to 'none' if the shop has no GSTIN on file
    if (!tenant.business?.gstin) {
        orders.gst = { mode: 'none', percent: 0 };
    }

    const labels = merge(DEFAULTS.labels, clean.labels);
    const weekly = clean.hours?.weekly || null;
    const status = openStatus(weekly, orders.acceptingOrders, now);

    return {
        brand,
        tabs,
        home,
        features,
        menu: merge(DEFAULTS.menu, clean.menu),
        orders,
        hours: { weekly, closedMessage: clean.hours?.closedMessage || labels.closedMessage },
        offers,
        labels,
        restaurant: {
            name: tenant.name,
            tagline: tenant.tagline || null,
            logo: tenant.logo || null,
            address: tenant.address || null,
            phone: tenant.phone || null,
            isOpen: status.isOpen,
            closedReason: status.reason,
        },
    };
}

module.exports = { validateSettings, resolveConfig, openStatus, DEFAULTS };