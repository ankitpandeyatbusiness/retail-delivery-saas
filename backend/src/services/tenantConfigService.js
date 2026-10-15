const O = require('../config/tenantOptions');
const platformTax = require('./platformTax');
const { resolveHomeConfig } = require('./homeConfigService');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d{1,4}(\.\d{1,4}){0,3}$/;
const MIN_SHOP_RATINGS = 20;   // the shop rating is shown to customers from this many dish ratings
const validDay = (v) => {   // a real calendar date like 2026-10-31
    if (typeof v !== 'string' || !DAY.test(v)) return false;
    const [y, mo, d] = v.split('-').map(Number);
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

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

    known(s, ['brand', 'tabs', 'home', 'features', 'menu', 'orders', 'hours', 'offers', 'labels', 'riders', 'notifications', 'app'], 'settings');

    // brand
    section('brand', ['colors', 'fontStyle', 'buttonShape', 'look', 'motion', 'headerStyle', 'tabBarStyle', 'categoryStyle', 'filterStyle'], (b, out, p) => {
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
        if (b.look !== undefined && oneOf(p('look'), b.look, O.LOOKS)) out.look = b.look;
        if (b.motion !== undefined && oneOf(p('motion'), b.motion, O.MOTION_LEVELS)) out.motion = b.motion;
        if (b.headerStyle !== undefined && oneOf(p('headerStyle'), b.headerStyle, O.HEADER_STYLES)) out.headerStyle = b.headerStyle;
        if (b.tabBarStyle !== undefined && oneOf(p('tabBarStyle'), b.tabBarStyle, O.TAB_BAR_STYLES)) out.tabBarStyle = b.tabBarStyle;
        if (b.categoryStyle !== undefined && oneOf(p('categoryStyle'), b.categoryStyle, O.CATEGORY_STYLES)) out.categoryStyle = b.categoryStyle;
        if (b.filterStyle !== undefined && oneOf(p('filterStyle'), b.filterStyle, O.FILTER_STYLES)) out.filterStyle = b.filterStyle;
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
        ['types', 'payments', 'minOrder', 'deliveryFee', 'packagingCharge', 'gst', 'tipOptions', 'prepTimeMin', 'acceptingOrders', 'codCap'],
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
                    known(d, ['type', 'amount', 'freeAbove', 'baseKm', 'baseFee', 'perKmFee', 'maxFee'], p('deliveryFee'));
                    out.deliveryFee = {};
                    if (d.type !== undefined && oneOf(p('deliveryFee.type'), d.type, O.FEE_TYPES)) out.deliveryFee.type = d.type;
                    if (d.amount !== undefined && num(p('deliveryFee.amount'), d.amount, 0, 1000)) out.deliveryFee.amount = d.amount;
                    if (d.freeAbove !== undefined && num(p('deliveryFee.freeAbove'), d.freeAbove, 0, 100000)) out.deliveryFee.freeAbove = d.freeAbove;
                    // type "distance": baseFee covers the first baseKm; every started km after that adds perKmFee; maxFee 0 = no limit
                    if (d.baseKm !== undefined && num(p('deliveryFee.baseKm'), d.baseKm, 0, 50)) out.deliveryFee.baseKm = d.baseKm;
                    if (d.baseFee !== undefined && num(p('deliveryFee.baseFee'), d.baseFee, 0, 1000)) out.deliveryFee.baseFee = d.baseFee;
                    if (d.perKmFee !== undefined && num(p('deliveryFee.perKmFee'), d.perKmFee, 0, 500)) out.deliveryFee.perKmFee = d.perKmFee;
                    if (d.maxFee !== undefined && num(p('deliveryFee.maxFee'), d.maxFee, 0, 2000)) out.deliveryFee.maxFee = d.maxFee;
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
            if (o.codCap !== undefined) {
                const c = o.codCap;
                if (!isObj(c)) err(p('codCap'), 'must be an object');
                else {
                    known(c, ['amount', 'firstOrders'], p('codCap'));
                    out.codCap = {};
                    if (c.amount !== undefined && num(p('codCap.amount'), c.amount, 0, 100000)) out.codCap.amount = c.amount;   // 0 = no limit
                    if (c.firstOrders !== undefined) {
                        if (!Number.isInteger(c.firstOrders)) err(p('codCap.firstOrders'), 'must be a whole number');
                        else if (num(p('codCap.firstOrders'), c.firstOrders, 0, 50)) out.codCap.firstOrders = c.firstOrders;
                    }
                }
            }
            if (o.tipOptions !== undefined) {
                if (!Array.isArray(o.tipOptions) || o.tipOptions.length > 5) err(p('tipOptions'), 'must be a list of up to 5 amounts');
                else if (o.tipOptions.every((n, i) => num(p(`tipOptions[${i}]`), n, 0, 500))) out.tipOptions = o.tipOptions;
            }
        });

    // hours
    section('hours', ['weekly', 'closedMessage', 'closedDates'], (h, out, p) => {
        // holiday mode: [{ from: '2026-11-01', to: '2026-11-03', message?: 'Closed for Diwali' }] (India dates, up to 30)
        if (h.closedDates !== undefined) {
            if (!Array.isArray(h.closedDates) || h.closedDates.length > 30) err(p('closedDates'), 'must be a list of up to 30 date ranges');
            else {
                out.closedDates = [];
                h.closedDates.forEach((r, i) => {
                    if (!isObj(r) || !validDay(r.from) || !validDay(r.to) || r.to < r.from) {
                        return err(p(`closedDates[${i}]`), 'needs from and to as YYYY-MM-DD, and "to" must not be before "from"');
                    }
                    if (r.message !== undefined && !str(p(`closedDates[${i}].message`), r.message, 120)) return;
                    const msg = typeof r.message === 'string' ? r.message.trim() : '';
                    out.closedDates.push({ from: r.from, to: r.to, ...(msg ? { message: msg } : {}) });
                });
            }
        }
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

    // riders and delivery assignment
    section('riders', ['assignMode', 'offerSeconds', 'maxActiveOrders', 'deliveryPin', 'liveTracking', 'locationIntervalSec', 'payPerDelivery'], (r, out, p) => {
        if (r.payPerDelivery !== undefined && num(p('payPerDelivery'), r.payPerDelivery, 0, 10000)) out.payPerDelivery = r.payPerDelivery;   // rupees per delivery
        if (r.assignMode !== undefined && oneOf(p('assignMode'), r.assignMode, O.ASSIGN_MODES)) out.assignMode = r.assignMode;
        if (r.offerSeconds !== undefined && num(p('offerSeconds'), r.offerSeconds, 30, 600)) out.offerSeconds = r.offerSeconds;
        if (r.maxActiveOrders !== undefined && num(p('maxActiveOrders'), r.maxActiveOrders, 1, 10)) out.maxActiveOrders = r.maxActiveOrders;
        if (r.deliveryPin !== undefined && bool(p('deliveryPin'), r.deliveryPin)) out.deliveryPin = r.deliveryPin;
        if (r.liveTracking !== undefined && bool(p('liveTracking'), r.liveTracking)) out.liveTracking = r.liveTracking;
        if (r.locationIntervalSec !== undefined && num(p('locationIntervalSec'), r.locationIntervalSec, 5, 60)) out.locationIntervalSec = r.locationIntervalSec;
    });

    // app: the oldest app version that may still be used. "" = no minimum. Set by the superadmin.
    section('app', ['minVersion'], (a, out, p) => {
        if (a.minVersion !== undefined) {
            if (a.minVersion === '' || (typeof a.minVersion === 'string' && VERSION.test(a.minVersion))) out.minVersion = a.minVersion;
            else err(p('minVersion'), 'must look like 1.2.0');
        }
    });

    // notifications (the owner's own switches)
    section('notifications', ['smsAlerts'], (n, out, p) => {
        if (n.smsAlerts !== undefined && bool(p('smsAlerts'), n.smsAlerts)) out.smsAlerts = n.smsAlerts;
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
    // the look defaults reproduce the app as it was before looks existed, so a shop changes only when its settings say so
    brand: {
        fontStyle: 'modern', buttonShape: 'rounded',
        look: 'bold', motion: 'full', headerStyle: 'hero', tabBarStyle: 'classic', categoryStyle: 'circles', filterStyle: 'dialog',
    },
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
        codCap: { amount: 1000, firstOrders: 3 },   // Cash on delivery is limited to this amount for a phone's first orders. amount 0 = off
    },
    offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
    notifications: { smsAlerts: true },   // key-event SMS (new order, bill, order steps) are on by default
    riders: { assignMode: 'automatic', offerSeconds: 120, maxActiveOrders: 3, deliveryPin: true, liveTracking: true, locationIntervalSec: 10 },
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
const addDay = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

// holiday: today (India date) is inside a closed range. reopensOn = the first day that is not closed.
function holidayOn(closedDates, now) {
    if (!Array.isArray(closedDates) || !closedDates.length) return null;
    const today = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const hit = closedDates.find((r) => r.from <= today && today <= r.to);
    if (!hit) return null;
    let last = hit.to;
    for (let i = 0; i < 31; i += 1) {
        const next = addDay(last);
        const more = closedDates.find((r) => r.from <= next && next <= r.to);
        if (!more) return { message: hit.message || null, reopensOn: next };
        last = more.to;
    }
    return { message: hit.message || null, reopensOn: addDay(last) };
}

function openStatus(weekly, acceptingOrders, now = new Date(), closedDates = null) {
    if (acceptingOrders === false) return { isOpen: false, reason: 'paused' };
    const holiday = holidayOn(closedDates, now);
    if (holiday) return { isOpen: false, reason: 'holiday', message: holiday.message, reopensOn: holiday.reopensOn };
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
// The logo's colours are the base; colours set in the panel win. If the panel sets a MAIN colour but not its light and
// dark shades, the logo's old shades are dropped, so the app derives matching ones from the new main colour
// (a blue main colour must not end up next to the logo's red light and dark shades).
function brandColors(fromLogo, fromPanel) {
    const set = fromPanel || {};
    const colors = { ...(fromLogo || {}), ...set };
    if (set.primary) {
        if (!set.primaryLight) delete colors.primaryLight;
        if (!set.primaryDark) delete colors.primaryDark;
    }
    return colors;
}

function resolveConfig(tenant, now = new Date()) {
    const { clean } = validateSettings(tenant.settings);

    const legacy = tenant.homeConfig || {};
    const home = resolveHomeConfig({ ...tenant, homeConfig: { ...legacy, ...(clean.home || {}) } });
    if (Array.isArray(clean.home?.filters)) home.filters = clean.home.filters; // explicit [] is respected

    const brand = {
        colors: brandColors(tenant.colors, clean.brand?.colors),
        fontStyle: clean.brand?.fontStyle || DEFAULTS.brand.fontStyle,
        buttonShape: clean.brand?.buttonShape || DEFAULTS.brand.buttonShape,
        look: clean.brand?.look || DEFAULTS.brand.look,
        motion: clean.brand?.motion || DEFAULTS.brand.motion,
        headerStyle: clean.brand?.headerStyle || DEFAULTS.brand.headerStyle,
        tabBarStyle: clean.brand?.tabBarStyle || DEFAULTS.brand.tabBarStyle,
        categoryStyle: clean.brand?.categoryStyle || DEFAULTS.brand.categoryStyle,
        filterStyle: clean.brand?.filterStyle || DEFAULTS.brand.filterStyle,
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

    // No COD during free service. Switched on with ENFORCE_NO_COD_IN_FREE=true (keep it OFF until online payments exist)
    if (process.env.ENFORCE_NO_COD_IN_FREE === 'true' && tenant.billing?.state === 'free') {
        orders.payments = (orders.payments || []).filter((m) => m !== 'cod');
    }

    // GST is ONE rate for every shop, set by the superadmin (never the shop), and only for a shop whose GST number
    // the superadmin has saved. Whatever a shop's own settings say about GST is ignored.
    orders.gst = tenant.business?.gstin ? platformTax.get() : { mode: 'none', percent: 0 };

    const labels = merge(DEFAULTS.labels, clean.labels);
    const weekly = clean.hours?.weekly || null;
    const closedDates = clean.hours?.closedDates || [];
    const status = openStatus(weekly, orders.acceptingOrders, now, closedDates);

    return {
        brand,
        tabs,
        home,
        features,
        menu: merge(DEFAULTS.menu, clean.menu),
        orders,
        hours: { weekly, closedMessage: clean.hours?.closedMessage || labels.closedMessage, closedDates },
        riders: {
            liveTracking: merge(DEFAULTS.riders, clean.riders).liveTracking,
            locationIntervalSec: merge(DEFAULTS.riders, clean.riders).locationIntervalSec,
        },
        offers,
        labels,
        app: { minVersion: clean.app?.minVersion || null },
        restaurant: {
            name: tenant.name,
            tagline: tenant.tagline || null,
            logo: tenant.logo || null,
            address: tenant.address || null,
            phone: tenant.phone || null,
            isOpen: status.isOpen,
            closedReason: status.reason,
            closedMessage: status.message || clean.hours?.closedMessage || labels.closedMessage,   // what to show when closed
            reopensOn: status.reopensOn || null,
            // the shop rating, only once enough customers rated
            rating: tenant.stats?.rating?.count >= MIN_SHOP_RATINGS
                ? { avg: tenant.stats.rating.avg, count: tenant.stats.rating.count }
                : null,                                                   // holiday: first open day (YYYY-MM-DD)
        },
    };
}

module.exports = { validateSettings, resolveConfig, openStatus, DEFAULTS, MIN_SHOP_RATINGS };