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
    section('brand', ['colors', 'fontStyle', 'buttonShape', 'look', 'lightLook', 'darkLook', 'motion', 'headerStyle', 'tabBarStyle', 'categoryStyle', 'filterStyle', 'locationStyle'], (b, out, p) => {
        if (b.colors !== undefined) {
            if (!isObj(b.colors)) err(p('colors'), 'must be an object');
            else {
                out.colors = {};
                for (const [k, v] of Object.entries(b.colors)) {
                    if (!O.COLOR_KEYS.includes(k)) err(p(`colors.${k}`), 'unknown color');
                    else if (v === '' || v === null) continue;   // cleared = not set
                    else if (!HEX.test(v)) err(p(`colors.${k}`), 'must look like #RRGGBB');
                    else out.colors[k] = v;
                }
            }
        }
        if (b.fontStyle !== undefined && oneOf(p('fontStyle'), b.fontStyle, O.FONT_STYLES)) out.fontStyle = b.fontStyle;
        if (b.buttonShape !== undefined && oneOf(p('buttonShape'), b.buttonShape, O.BUTTON_SHAPES)) out.buttonShape = b.buttonShape;
        if (b.look !== undefined && oneOf(p('look'), b.look, O.LOOKS)) out.look = b.look;   // the old single setting
        if (b.lightLook !== undefined && oneOf(p('lightLook'), b.lightLook, O.LIGHT_LOOKS)) out.lightLook = b.lightLook;
        if (b.darkLook !== undefined && oneOf(p('darkLook'), b.darkLook, O.DARK_LOOKS)) out.darkLook = b.darkLook;
        if (b.motion !== undefined && oneOf(p('motion'), b.motion, O.MOTION_LEVELS)) out.motion = b.motion;
        if (b.headerStyle !== undefined && oneOf(p('headerStyle'), b.headerStyle, O.HEADER_STYLES)) out.headerStyle = b.headerStyle;
        if (b.tabBarStyle !== undefined && oneOf(p('tabBarStyle'), b.tabBarStyle, O.TAB_BAR_STYLES)) out.tabBarStyle = b.tabBarStyle;
        if (b.categoryStyle !== undefined && oneOf(p('categoryStyle'), b.categoryStyle, O.CATEGORY_STYLES)) out.categoryStyle = b.categoryStyle;
        if (b.filterStyle !== undefined && oneOf(p('filterStyle'), b.filterStyle, O.FILTER_STYLES)) out.filterStyle = b.filterStyle;
        if (b.locationStyle !== undefined && oneOf(p('locationStyle'), b.locationStyle, O.LOCATION_STYLES)) out.locationStyle = b.locationStyle;
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
        ['types', 'payments', 'minOrder', 'deliveryFee', 'packagingCharge', 'gst', 'tipOptions', 'prepTimeMin', 'kitchenQueueSec', 'acceptingOrders', 'pausedUntil', 'busy', 'codCap', 'pickupCod', 'pickupRules', 'mixRules', 'limits', 'staff', 'dineIn', 'autoAccept'],   // autoAccept is the owner's own (services/autoAccept.js): known here so a panel save does not fail on it, never taken from the panel
        (o, out, p) => {
            if (o.types !== undefined) { const v = listOf(p('types'), o.types, O.ORDER_TYPES, 1, 3); if (v) out.types = v; }
            if (o.payments !== undefined) { const v = listOf(p('payments'), o.payments, O.PAYMENT_METHODS, 1, 4); if (v) out.payments = v; }
            if (o.minOrder !== undefined && num(p('minOrder'), o.minOrder, 0, 5000)) out.minOrder = o.minOrder;
            if (o.packagingCharge !== undefined && num(p('packagingCharge'), o.packagingCharge, 0, 500)) out.packagingCharge = o.packagingCharge;
            if (o.prepTimeMin !== undefined && num(p('prepTimeMin'), o.prepTimeMin, 0, 240)) out.prepTimeMin = o.prepTimeMin;
            if (o.kitchenQueueSec !== undefined && num(p('kitchenQueueSec'), o.kitchenQueueSec, 15, 600)) out.kitchenQueueSec = o.kitchenQueueSec;   // seconds before an order the cook did not touch goes to his queue by itself
            if (o.acceptingOrders !== undefined && bool(p('acceptingOrders'), o.acceptingOrders)) out.acceptingOrders = o.acceptingOrders;
            // a timed pause set by the owner ("pause for 30 minutes"): taking orders resumes by itself at this moment. null = none.
            // It is saved as a Date, and read back as a Date or an ISO text.
            if (o.pausedUntil !== undefined) {
                if (o.pausedUntil === null) out.pausedUntil = null;
                else if ((o.pausedUntil instanceof Date || typeof o.pausedUntil === 'string') && !Number.isNaN(new Date(o.pausedUntil).getTime())) out.pausedUntil = o.pausedUntil;
                else err(p('pausedUntil'), 'must be a date and time');
            }
            // busy mode set by the owner: for a while customers see a longer wait. null = none.
            if (o.busy !== undefined) {
                if (o.busy === null) out.busy = null;
                else if (!isObj(o.busy)) err(p('busy'), 'must be an object');
                else {
                    known(o.busy, ['extraMin', 'until'], p('busy'));
                    const u = o.busy.until;
                    if (!Number.isInteger(o.busy.extraMin) || o.busy.extraMin < 0 || o.busy.extraMin > 120) err(p('busy.extraMin'), 'must be a whole number from 0 to 120');
                    else if (!((u instanceof Date || typeof u === 'string') && !Number.isNaN(new Date(u).getTime()))) err(p('busy.until'), 'must be a date and time');
                    else out.busy = { extraMin: o.busy.extraMin, until: u };
                }
            }
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
            // cash for PICKUP orders: the shop can switch it off, or allow it only up to an amount (0 = no limit)
            if (o.pickupCod !== undefined) {
                const c = o.pickupCod;
                if (!isObj(c)) err(p('pickupCod'), 'must be an object');
                else {
                    known(c, ['enabled', 'max'], p('pickupCod'));
                    out.pickupCod = {};
                    if (c.enabled !== undefined && bool(p('pickupCod.enabled'), c.enabled)) out.pickupCod.enabled = c.enabled;
                    if (c.max !== undefined && num(p('pickupCod.max'), c.max, 0, 100000)) out.pickupCod.max = c.max;
                }
            }
            // pickup orders: how many one customer may have waiting at a time (0 = no limit), and whether he may move the time
            if (o.pickupRules !== undefined) {
                const c = o.pickupRules;
                if (!isObj(c)) err(p('pickupRules'), 'must be an object');
                else {
                    known(c, ['openMax', 'canChange'], p('pickupRules'));
                    out.pickupRules = {};
                    if (c.openMax !== undefined && num(p('pickupRules.openMax'), c.openMax, 0, 10)) out.pickupRules.openMax = Math.floor(c.openMax);
                    if (c.canChange !== undefined && bool(p('pickupRules.canChange'), c.canChange)) out.pickupRules.canChange = c.canChange;
                }
            }
            // platform rules for this shop, set from the super admin panel only (timings and counts that used to be fixed in the code)
            // kitchen and waiter panels: which ones this shop has, and how many people (super admin only)
            if (o.staff !== undefined) {
                const c = o.staff;
                if (!isObj(c)) err(p('staff'), 'must be an object');
                else {
                    known(c, ['kitchenOn', 'waiterOn', 'max', 'kitchenSees', 'lateMin', 'serveLateMin', 'queueShown', 'queueEta', 'kitchenLanes', 'nudgeMin'], p('staff'));
                    out.staff = {};
                    if (c.kitchenOn !== undefined && bool(p('staff.kitchenOn'), c.kitchenOn)) out.staff.kitchenOn = c.kitchenOn;
                    if (c.waiterOn !== undefined && bool(p('staff.waiterOn'), c.waiterOn)) out.staff.waiterOn = c.waiterOn;
                    if (c.max !== undefined) {
                        if (!Number.isInteger(c.max)) err(p('staff.max'), 'must be a whole number');
                        else if (num(p('staff.max'), c.max, 1, 50)) out.staff.max = c.max;
                    }
                    if (c.kitchenSees !== undefined) { const v = listOf(p('staff.kitchenSees'), c.kitchenSees, O.ORDER_TYPES, 1, 3); if (v) out.staff.kitchenSees = v; }   // which kinds of order the cook sees
                    if (c.lateMin !== undefined) {   // minutes after an order is accepted (or its start time) before the kitchen shows it as late
                        if (!Number.isInteger(c.lateMin)) err(p('staff.lateMin'), 'must be a whole number');
                        else if (num(p('staff.lateMin'), c.lateMin, 5, 180)) out.staff.lateMin = c.lateMin;
                    }
                    for (const k of ['queueShown', 'queueEta']) { if (c[k] !== undefined && bool(p('staff.' + k), c[k])) out.staff[k] = c[k]; }   // the guest sees his place in the kitchen / the time it will take
                    if (c.nudgeMin !== undefined) {   // minutes an accepted order may wait for a cook before the cooks get a push (0 = no nudges)
                        if (!Number.isInteger(c.nudgeMin)) err(p('staff.nudgeMin'), 'must be a whole number');
                        else if (num(p('staff.nudgeMin'), c.nudgeMin, 0, 120)) out.staff.nudgeMin = c.nudgeMin;
                    }
                    if (c.kitchenLanes !== undefined) {   // how many orders the kitchen cooks at the same time (the time estimate uses it)
                        if (!Number.isInteger(c.kitchenLanes)) err(p('staff.kitchenLanes'), 'must be a whole number');
                        else if (num(p('staff.kitchenLanes'), c.kitchenLanes, 1, 20)) out.staff.kitchenLanes = c.kitchenLanes;
                    }
                    if (c.serveLateMin !== undefined) {   // minutes a ready dish may wait for the waiter before it shows as late
                        if (!Number.isInteger(c.serveLateMin)) err(p('staff.serveLateMin'), 'must be a whole number');
                        else if (num(p('staff.serveLateMin'), c.serveLateMin, 1, 60)) out.staff.serveLateMin = c.serveLateMin;
                    }
                }
            }
            if (o.limits !== undefined) {
                const c = o.limits;
                if (!isObj(c)) err(p('limits'), 'must be an object');
                else {
                    const RANGE = { pickupAsksMax: [1, 10], nudgeFirstMin: [0, 60], nudgeEveryMin: [1, 120], callGapMin: [0, 60], callClearHours: [1, 24], remindGapMin: [0, 1440], claimRetryMin: [0, 1440], scanGapMin: [0, 1440], strikesMax: [1, 10], pickupSlotsPerDay: [1, 24] };
                    known(c, Object.keys(RANGE), p('limits'));
                    out.limits = {};
                    for (const [k, [lo, hi]] of Object.entries(RANGE)) if (c[k] !== undefined && num(p(`limits.${k}`), c[k], lo, hi)) out.limits[k] = Math.floor(c[k]);
                }
            }
            // several kinds of order at once: the owner's protections
            if (o.mixRules !== undefined) {
                const c = o.mixRules;
                if (!isObj(c)) err(p('mixRules'), 'must be an object');
                else {
                    known(c, ['dineBlocksOthers', 'deliveryOpenMax', 'exposureOn', 'exposureNew', 'exposureTrusted', 'regularAfter'], p('mixRules'));
                    out.mixRules = {};
                    if (c.dineBlocksOthers !== undefined && bool(p('mixRules.dineBlocksOthers'), c.dineBlocksOthers)) out.mixRules.dineBlocksOthers = c.dineBlocksOthers;
                    if (c.exposureOn !== undefined && bool(p('mixRules.exposureOn'), c.exposureOn)) out.mixRules.exposureOn = c.exposureOn;
                    if (c.deliveryOpenMax !== undefined && num(p('mixRules.deliveryOpenMax'), c.deliveryOpenMax, 0, 10)) out.mixRules.deliveryOpenMax = Math.floor(c.deliveryOpenMax);
                    if (c.regularAfter !== undefined && num(p('mixRules.regularAfter'), c.regularAfter, 1, 50)) out.mixRules.regularAfter = Math.floor(c.regularAfter);
                    if (c.exposureNew !== undefined && num(p('mixRules.exposureNew'), c.exposureNew, 0, 100000)) out.mixRules.exposureNew = c.exposureNew;
                    if (c.exposureTrusted !== undefined && num(p('mixRules.exposureTrusted'), c.exposureTrusted, 0, 100000)) out.mixRules.exposureTrusted = c.exposureTrusted;
                }
            }
            // dine in: the owner switches it on and says how many tables there are (more settings come with the table bill)
            if (o.dineIn !== undefined) {
                const c = o.dineIn;
                if (!isObj(c)) err(p('dineIn'), 'must be an object');
                else {
                    known(c, ['enabled', 'tableCount', 'autoCloseHours', 'tabLimitNew', 'tabLimitTrusted', 'trustedAfter', 'atShopCheck', 'radiusM', 'checkMinutes', 'autoReady', 'readyMin', 'autoServe', 'serveMin', 'owedDaily', 'owedHour', 'owedOnHome', 'owedMax', 'firstOnline', 'prefs', 'welcomeOn', 'welcomePercent', 'welcomeMax', 'regularOn', 'regularAfter', 'regularPercent', 'regularMax', 'happyOn', 'happyFrom', 'happyTo', 'happyPercent', 'happyMax', 'waitMin', 'callOn', 'tipOn', 'tipChoices', 'feedbackOn', 'referOn', 'referFriendPercent', 'referFriendMax', 'referPoints', 'referLimit', 'busyAuto', 'busyPercent', 'busyExtraMin', 'cancelGraceMin', 'waiterSettles', 'upiId', 'sharedTables', 'maxParties', 'guestWatch', 'unreachableMin'], p('dineIn'));
                    out.dineIn = {};
                    if (c.enabled !== undefined && bool(p('dineIn.enabled'), c.enabled)) out.dineIn.enabled = c.enabled;
                    if (c.tableCount !== undefined) {
                        if (!Number.isInteger(c.tableCount)) err(p('dineIn.tableCount'), 'must be a whole number');
                        else if (num(p('dineIn.tableCount'), c.tableCount, 1, 200)) out.dineIn.tableCount = c.tableCount;
                    }
                    // walk-out protection: how much a table may owe, who is trusted, the "must be at the shop" check, the "check on the table" time
                    if (c.tabLimitNew !== undefined && num(p('dineIn.tabLimitNew'), c.tabLimitNew, 0, 100000)) out.dineIn.tabLimitNew = c.tabLimitNew;   // 0 = no limit
                    if (c.tabLimitTrusted !== undefined && num(p('dineIn.tabLimitTrusted'), c.tabLimitTrusted, 0, 100000)) out.dineIn.tabLimitTrusted = c.tabLimitTrusted;
                    if (c.trustedAfter !== undefined) {
                        if (!Number.isInteger(c.trustedAfter)) err(p('dineIn.trustedAfter'), 'must be a whole number');
                        else if (num(p('dineIn.trustedAfter'), c.trustedAfter, 1, 50)) out.dineIn.trustedAfter = c.trustedAfter;
                    }
                    if (c.atShopCheck !== undefined && bool(p('dineIn.atShopCheck'), c.atShopCheck)) out.dineIn.atShopCheck = c.atShopCheck;
                    if (c.radiusM !== undefined) {
                        if (!Number.isInteger(c.radiusM)) err(p('dineIn.radiusM'), 'must be a whole number');
                        else if (num(p('dineIn.radiusM'), c.radiusM, 50, 5000)) out.dineIn.radiusM = c.radiusM;
                    }
                    if (c.checkMinutes !== undefined) {
                        if (!Number.isInteger(c.checkMinutes)) err(p('dineIn.checkMinutes'), 'must be a whole number');
                        else if (num(p('dineIn.checkMinutes'), c.checkMinutes, 5, 240)) out.dineIn.checkMinutes = c.checkMinutes;
                    }
                    if (c.autoReady !== undefined && bool(p('dineIn.autoReady'), c.autoReady)) out.dineIn.autoReady = c.autoReady;
                    if (c.owedDaily !== undefined && bool(p('dineIn.owedDaily'), c.owedDaily)) out.dineIn.owedDaily = c.owedDaily;   // remind everyone with an unpaid bill, once a day
                    if (c.owedOnHome !== undefined && bool(p('dineIn.owedOnHome'), c.owedOnHome)) out.dineIn.owedOnHome = c.owedOnHome;   // the Unpaid bills card on the owner's Home
                    if (c.firstOnline !== undefined && bool(p('dineIn.firstOnline'), c.firstOnline)) out.dineIn.firstOnline = c.firstOnline;   // a customer's very first table visit must be paid online
                    if (c.owedMax !== undefined) {
                        if (!Number.isInteger(c.owedMax)) err(p('dineIn.owedMax'), 'must be a whole number');
                        else if (num(p('dineIn.owedMax'), c.owedMax, 1, 60)) out.dineIn.owedMax = c.owedMax;
                    }
                    if (c.prefs !== undefined) {   // the quick choices a customer taps on his table order: "Make it spicy"...
                        const list = Array.isArray(c.prefs) ? c.prefs.map((x) => (typeof x === 'string' ? x.trim() : '')) : null;
                        if (!list || list.length > 12) err(p('dineIn.prefs'), 'must be a list of up to 12 choices');
                        else if (list.some((x) => !x || x.length > 30)) err(p('dineIn.prefs'), 'each choice must be 1 to 30 letters');
                        else out.dineIn.prefs = [...new Set(list)];
                    }
                    if (c.cancelGraceMin !== undefined && num(p('dineIn.cancelGraceMin'), c.cancelGraceMin, 0, 30)) out.dineIn.cancelGraceMin = Math.floor(c.cancelGraceMin);   // minutes a guest may cancel a round himself (0 = never)
                    if (c.owedHour !== undefined) {
                        if (!Number.isInteger(c.owedHour)) err(p('dineIn.owedHour'), 'must be a whole number');
                        else if (num(p('dineIn.owedHour'), c.owedHour, 0, 23)) out.dineIn.owedHour = c.owedHour;
                    }
                    if (c.referOn !== undefined && bool(p('dineIn.referOn'), c.referOn)) out.dineIn.referOn = c.referOn;   // "refer a friend"
                    for (const [k, lo, hi] of [['referFriendPercent', 1, 100], ['referFriendMax', 0, 100000], ['referPoints', 1, 1000], ['referLimit', 1, 100]]) {
                        if (c[k] === undefined) continue;
                        if (!Number.isInteger(c[k])) err(p('dineIn.' + k), 'must be a whole number');
                        else if (num(p('dineIn.' + k), c[k], lo, hi)) out.dineIn[k] = c[k];
                    }
                    if (c.sharedTables !== undefined && bool(p('dineIn.sharedTables'), c.sharedTables)) out.dineIn.sharedTables = c.sharedTables;   // different people may share one table, each with their own bill
                    if (c.maxParties !== undefined) {   // the most bills one table may have
                        if (!Number.isInteger(c.maxParties)) err(p('dineIn.maxParties'), 'must be a whole number');
                        else if (num(p('dineIn.maxParties'), c.maxParties, 2, 8)) out.dineIn.maxParties = c.maxParties;
                    }
                    if (c.guestWatch !== undefined && bool(p('dineIn.guestWatch'), c.guestWatch)) out.dineIn.guestWatch = c.guestWatch;   // tell the owner (quietly) when a guest who owes cannot be reached
                    if (c.unreachableMin !== undefined) {
                        if (!Number.isInteger(c.unreachableMin)) err(p('dineIn.unreachableMin'), 'must be a whole number');
                        else if (num(p('dineIn.unreachableMin'), c.unreachableMin, 3, 60)) out.dineIn.unreachableMin = c.unreachableMin;
                    }
                    if (c.upiId !== undefined) {   // the shop's UPI id: the waiter shows a QR for it, so a guest can pay at the table. Empty = none.
                        const u = typeof c.upiId === 'string' ? c.upiId.trim() : null;
                        if (u === null) err(p('dineIn.upiId'), 'must be text');
                        else if (u && !/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,30}$/.test(u)) err(p('dineIn.upiId'), 'must look like shopname@bank');
                        else out.dineIn.upiId = u;
                    }
                    if (c.waiterSettles !== undefined && bool(p('dineIn.waiterSettles'), c.waiterSettles)) out.dineIn.waiterSettles = c.waiterSettles;   // a waiter may take the money of a table bill
                    for (const k of ['callOn', 'tipOn', 'feedbackOn']) { if (c[k] !== undefined && bool(p('dineIn.' + k), c[k])) out.dineIn[k] = c[k]; }
                    if (c.tipChoices !== undefined) {   // the tip amounts a guest can tap (rupees)
                        const list = Array.isArray(c.tipChoices) ? c.tipChoices : null;
                        if (!list || list.length > 4 || list.some((x) => !Number.isInteger(x) || x < 1 || x > 1000)) err(p('dineIn.tipChoices'), 'must be up to 4 whole amounts from 1 to 1000');
                        else out.dineIn.tipChoices = [...new Set(list)];
                    }
                    for (const k of ['welcomeOn', 'regularOn', 'happyOn']) { if (c[k] !== undefined && bool(p('dineIn.' + k), c[k])) out.dineIn[k] = c[k]; }
                    for (const [k, lo, hi] of [['welcomePercent', 1, 100], ['welcomeMax', 0, 100000], ['regularAfter', 1, 50], ['regularPercent', 1, 100], ['regularMax', 0, 100000], ['happyPercent', 1, 90], ['happyMax', 0, 100000], ['waitMin', 0, 180]]) {
                        if (c[k] === undefined) continue;
                        if (!Number.isInteger(c[k])) err(p('dineIn.' + k), 'must be a whole number');
                        else if (num(p('dineIn.' + k), c[k], lo, hi)) out.dineIn[k] = c[k];
                    }
                    for (const k of ['happyFrom', 'happyTo']) {
                        if (c[k] === undefined) continue;
                        if (typeof c[k] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c[k])) err(p('dineIn.' + k), 'must look like 15:30');
                        else out.dineIn[k] = c[k];
                    }
                    if (c.autoServe !== undefined && bool(p('dineIn.autoServe'), c.autoServe)) out.dineIn.autoServe = c.autoServe;   // a ready dish is marked served by itself after serveMin   // dishes are marked ready by themselves after readyMin
                    if (c.busyAuto !== undefined && bool(p('dineIn.busyAuto'), c.busyAuto)) out.dineIn.busyAuto = c.busyAuto;   // customers are told it may take longer when many tables are full
                    for (const [k, lo, hi] of [['readyMin', 1, 120], ['serveMin', 1, 120], ['busyPercent', 10, 100], ['busyExtraMin', 5, 90]]) {
                        if (c[k] === undefined) continue;
                        if (!Number.isInteger(c[k])) err(p('dineIn.' + k), 'must be a whole number');
                        else if (num(p('dineIn.' + k), c[k], lo, hi)) out.dineIn[k] = c[k];
                    }
                    if (c.autoCloseHours !== undefined) {
                        if (!Number.isInteger(c.autoCloseHours)) err(p('dineIn.autoCloseHours'), 'must be a whole number');
                        else if (num(p('dineIn.autoCloseHours'), c.autoCloseHours, 1, 48)) out.dineIn.autoCloseHours = c.autoCloseHours;
                    }
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
    section('riders', ['assignMode', 'offerSeconds', 'maxActiveOrders', 'deliveryPin', 'liveTracking', 'locationIntervalSec', 'payPerDelivery', 'pay', 'trackPayouts', 'payUndelivered', 'cashLimit'], (r, out, p) => {
        if (r.pay !== undefined) {   // how riders are paid (services/riderPay.js)
            const v = require('./riderPay').validatePlan(r.pay);
            if (v.ok) { out.pay = v.clean; out.payPerDelivery = v.clean.type === 'per_delivery' ? v.clean.perDelivery : 0; } else v.errors.forEach((m) => err(p('pay'), m));
        }
        if (r.trackPayouts !== undefined && bool(p('trackPayouts'), r.trackPayouts)) out.trackPayouts = r.trackPayouts;   // the owner records what he pays riders
        if (r.payUndelivered !== undefined && bool(p('payUndelivered'), r.payUndelivered)) out.payUndelivered = r.payUndelivered;   // pay for food collected but not delivered
        if (r.cashLimit !== undefined && num(p('cashLimit'), r.cashLimit, 0, 1000000)) out.cashLimit = r.cashLimit;   // rupees of cash a rider may hold before new orders stop (0 = no limit)
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
    section('notifications', ['smsAlerts', 'monthlyReport'], (n, out, p) => {
        if (n.smsAlerts !== undefined && bool(p('smsAlerts'), n.smsAlerts)) out.smsAlerts = n.smsAlerts;
        if (n.monthlyReport !== undefined && bool(p('monthlyReport'), n.monthlyReport)) out.monthlyReport = n.monthlyReport;   // the monthly progress report (in the app and by email)
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
        lightLook: 'bold', darkLook: 'midnight', motion: 'full', headerStyle: 'hero', tabBarStyle: 'classic', categoryStyle: 'circles', filterStyle: 'dialog', locationStyle: 'card',
    },
    tabs: ['home', 'search', 'orders', 'profile'],
    features: {
        ratingBadge: true, prepTime: true, serves: false, calories: false,
        specialInstructions: true, scheduleOrder: false, reorder: true, favourites: false,
        guestBrowsing: true, couponField: true, tips: false,
        directions: true,
    },
    menu: { outOfStock: 'dim', groupByCategory: true },
    orders: {
        types: ['delivery'], payments: ['cod'], minOrder: 0,
        deliveryFee: { type: 'free', amount: 0, freeAbove: 0 },
        packagingCharge: 0, gst: { mode: 'none', percent: 0 },
        tipOptions: [], prepTimeMin: 20, kitchenQueueSec: 60, acceptingOrders: true,
        dineIn: { enabled: false, sharedTables: false, maxParties: 4, guestWatch: true, unreachableMin: 10, tableCount: 10, autoCloseHours: 6, tabLimitNew: 500, tabLimitTrusted: 2000, trustedAfter: 3, atShopCheck: true, radiusM: 250, checkMinutes: 20, autoReady: false, readyMin: 15, autoServe: false, serveMin: 10, owedDaily: false, owedHour: 11, owedOnHome: true, referOn: false, referFriendPercent: 15, referFriendMax: 150, referPoints: 50, referLimit: 10, callOn: false, tipOn: false, tipChoices: [10, 20, 50], feedbackOn: false, welcomeOn: false, welcomePercent: 10, welcomeMax: 100, regularOn: false, regularAfter: 5, regularPercent: 5, regularMax: 50, happyOn: false, happyFrom: '15:00', happyTo: '18:00', happyPercent: 15, happyMax: 150, waitMin: 0, owedMax: 7, firstOnline: false, prefs: ['Make it spicy', 'Less spicy', 'Not spicy', 'Extra gravy', 'Less gravy', 'No coriander', 'No onion', 'No garlic', 'Less oil', 'Less salt'], busyAuto: true, busyPercent: 70, busyExtraMin: 10, cancelGraceMin: 3, waiterSettles: true },   // eating at the shop: on/off and how many tables
        staff: { kitchenOn: false, waiterOn: false, max: 10, kitchenSees: ['delivery', 'pickup', 'dine_in'], lateMin: 20, serveLateMin: 5, queueShown: true, queueEta: true, kitchenLanes: 3, nudgeMin: 10 },   // kitchen and waiter panels (services/staffService.js): off until the super admin switches them on
        mixRules: { dineBlocksOthers: true, deliveryOpenMax: 3, exposureOn: true, exposureNew: 800, exposureTrusted: 3000, regularAfter: 3 },
        limits: { pickupAsksMax: 3, nudgeFirstMin: 3, nudgeEveryMin: 10, callGapMin: 2, callClearHours: 2, remindGapMin: 30, claimRetryMin: 5, scanGapMin: 5, strikesMax: 2, pickupSlotsPerDay: 12 },   // timings and counts, set by the super admin   // several kinds of order at once (services/orderMix.js)
        pickupRules: { openMax: 2, canChange: true },   // pickup: orders one customer may have waiting (0 = no limit), and may he move his time
        pickupCod: { enabled: true, max: 0 },   // cash when the customer collects: allowed or not, and the highest order (0 = no limit)
        codCap: { amount: 1000, firstOrders: 3 },   // Cash on delivery is limited to this amount for a phone's first orders. amount 0 = off
    },
    offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
    notifications: { smsAlerts: true, monthlyReport: true },   // key-event SMS (new order, bill, order steps) are on by default
    riders: { assignMode: 'automatic', offerSeconds: 120, maxActiveOrders: 3, deliveryPin: true, liveTracking: true, locationIntervalSec: 10, trackPayouts: false, payUndelivered: false, cashLimit: 0 },
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
    for (const k of Object.keys(colors)) if (!colors[k]) delete colors[k];   // an emptied colour is simply not set
    if (set.primary) {
        if (!set.primaryLight) delete colors.primaryLight;
        if (!set.primaryDark) delete colors.primaryDark;
    }
    return colors;
}

// The logo shown inside the apps: the shop's own logo, else the app icon saved for its branding on the media storage
const brandingIcon = (slug) => {
    const base = String(process.env.MEDIA_CDN_URL || process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
    return base && slug ? `${base}/tenants/${slug}/branding/icon.png` : null;
};

function resolveConfig(tenant, now = new Date()) {
    const { clean } = validateSettings(tenant.settings);

    const legacy = tenant.homeConfig || {};
    const home = resolveHomeConfig({ ...tenant, homeConfig: { ...legacy, ...(clean.home || {}) } });
    if (Array.isArray(clean.home?.filters)) home.filters = clean.home.filters; // explicit [] is respected

    const brand = {
        colors: brandColors(tenant.colors, clean.brand?.colors),
        fontStyle: clean.brand?.fontStyle || DEFAULTS.brand.fontStyle,
        buttonShape: clean.brand?.buttonShape || DEFAULTS.brand.buttonShape,
        // a shop that only has the old single "look": a light one becomes its light theme, "midnight" meant
        // "fresh in light mode, midnight in dark mode"
        lightLook: clean.brand?.lightLook
            || (O.LIGHT_LOOKS.includes(clean.brand?.look) ? clean.brand.look : (clean.brand?.look ? 'fresh' : DEFAULTS.brand.lightLook)),
        darkLook: clean.brand?.darkLook || (O.DARK_LOOKS.includes(clean.brand?.look) ? clean.brand.look : DEFAULTS.brand.darkLook),
        motion: clean.brand?.motion || DEFAULTS.brand.motion,
        headerStyle: clean.brand?.headerStyle || DEFAULTS.brand.headerStyle,
        tabBarStyle: clean.brand?.tabBarStyle || DEFAULTS.brand.tabBarStyle,
        categoryStyle: clean.brand?.categoryStyle || DEFAULTS.brand.categoryStyle,
        filterStyle: clean.brand?.filterStyle || DEFAULTS.brand.filterStyle,
        locationStyle: clean.brand?.locationStyle || DEFAULTS.brand.locationStyle,
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
    // A timed pause: while it lasts nobody can order; when it is over this simply stops applying, so the shop reopens by
    // itself (nothing has to run at that moment). The config shows pausedUntil only while it is in force.
    const pausedUntil = orders.pausedUntil ? new Date(orders.pausedUntil) : null;
    if (pausedUntil && pausedUntil.getTime() > now.getTime()) {
        orders.acceptingOrders = false;
        orders.pausedUntil = pausedUntil.toISOString();
    } else {
        delete orders.pausedUntil;
    }

    // Busy mode: while it lasts the prepare time is longer; afterwards it simply stops applying
    const busy = orders.busy;
    if (busy && busy.until && new Date(busy.until).getTime() > now.getTime() && busy.extraMin > 0) {
        orders.prepTimeMin = (orders.prepTimeMin || 0) + busy.extraMin;
        orders.busy = { extraMin: busy.extraMin, until: new Date(busy.until).toISOString() };
    } else {
        delete orders.busy;
    }

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
        points: { customer: tenant.settings?.loyalty?.customer?.enabled !== false, rider: tenant.settings?.loyalty?.rider?.enabled !== false },   // the shop's points system, on unless switched off
        app: { minVersion: clean.app?.minVersion || null },
        restaurant: {
            name: tenant.name,
            tagline: tenant.tagline || null,
            logo: tenant.logo || brandingIcon(tenant.slug),
            address: tenant.address || null,
            // where the shop is pinned on the map (null when it is not): the customer app's Directions button needs it
            latitude: Number.isFinite(tenant.delivery?.latitude) ? tenant.delivery.latitude : null,
            longitude: Number.isFinite(tenant.delivery?.longitude) ? tenant.delivery.longitude : null,
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