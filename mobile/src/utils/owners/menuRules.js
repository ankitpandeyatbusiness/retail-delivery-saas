// The menu forms' rules in one place, kept free of screens so they are easy to check. They mirror the server's
// (backend/src/routes/shopManageRouter.js, services/itemRules.js, optionGroups.js, categoryTimings.js): the server has the
// last word, these only tell the owner early and in plain words.

// "south  indian" -> "South Indian"; short all-capital words (BBQ) stay. Same as the server.
export const titleCase = (s) =>
    String(s).trim().replace(/\s+/g, ' ').split(' ')
        .map((w) => (w.length <= 3 && /[A-Z]/.test(w) && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(' ');

/* ------------------------------ amounts ------------------------------ */
// 250 -> "250 g", 1500 -> "1.5 kg" (ml / L for volume)
export function amountLabel(sellBy, qty) {
    const [small, big] = sellBy === 'volume' ? ['ml', 'L'] : ['g', 'kg'];
    return qty >= 1000 ? `${Math.round(qty) / 1000} ${big}` : `${qty} ${small}`;
}

// Stock is kept in pieces, or grams / ml for an item sold by weight / volume. The owner types kg and litres.
export function stockUnit(sellBy) {
    if (sellBy === 'weight' || sellBy === 'volume') {
        return {
            suffix: sellBy === 'volume' ? 'L' : 'kg',
            integer: false,
            show: (n) => (n === undefined || n === null ? undefined : Math.round(n) / 1000),
            fromUi: (x) => Math.round(x * 1000),
            say: (n) => amountLabel(sellBy, n),
        };
    }
    return { suffix: 'pcs', integer: true, show: (n) => (n === undefined || n === null ? undefined : n), fromUi: (x) => Math.round(x), say: (n) => `${n}` };
}

/* ------------------------------ choices (sizes, add-ons) ------------------------------ */
export const MAX_GROUPS = 8;
export const MAX_OPTIONS = 30;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// Server ids are short and stable ("large", "oat-milk"). Keep the ones that exist, make new ones from the name.
export function withIds(groups) {
    const usedG = new Set();
    return groups.map((g, gi) => {
        let gid = g.id || slug(g.name) || `group-${gi + 1}`;
        while (usedG.has(gid)) gid = `${gid}-${gi + 1}`.slice(0, 30);
        usedG.add(gid);
        const usedO = new Set();
        const options = (g.options || []).map((o, oi) => {
            let id = o.id || slug(o.name) || `option-${oi + 1}`;
            while (usedO.has(id)) id = `${id}-${oi + 1}`.slice(0, 30);
            usedO.add(id);
            return { id, name: o.name.trim(), price: Number(o.price) || 0, isDefault: !!o.isDefault, isAvailable: o.isAvailable !== false };
        });
        const max = Math.min(Math.max(Number(g.max) || 1, 1), Math.max(options.length, 1));
        const min = Math.min(Math.max(Number(g.min) || 0, 0), max);
        return { id: gid, name: g.name.trim(), min, max, options };
    });
}

/* ------------------------------ opening hours of a category ------------------------------ */
export const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// "0730" -> "07:30" while typing
export const maskTime = (v) => {
    const d = String(v).replace(/[^\d]/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
// "20261101" -> "2026-11-01" while typing
export const maskDate = (v) => {
    const d = String(v).replace(/[^\d]/g, '').slice(0, 8);
    if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return d;
};
export const ymdOf = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');   // India date
// a typed day -> an instant: start of that day (or its end) in India time. '' -> undefined
export function isoOfYmd(ymd, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return undefined;
    const t = Date.parse(`${ymd}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30`);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

/* ------------------------------ the item form ------------------------------ */
export const SPICE = [['none', 'No spice'], ['mild', 'Mild'], ['medium', 'Medium'], ['hot', 'Hot']];

export const BLANK_ITEM = {
    categoryId: '', newCategory: '', name: '', description: '', image: '', images: [], price: undefined, mrp: undefined,
    isVeg: undefined, isEggless: false, isSugarFree: false, isJain: false, spiceLevel: 'none',
    isBestseller: false, isNewArrival: false, isGiftPack: false, serves: undefined, calories: undefined, prepTimeMin: undefined, maxPerOrder: undefined,
    optionGroups: [], isActive: true,
    itemKind: '', sellBy: 'piece', measure: { options: [], min: undefined, allowManual: true },
};

export const itemFromRecord = (r) => ({
    categoryId: r.categoryId ? String(r.categoryId) : '', newCategory: '',
    name: r.name || '', description: r.description || '', image: r.image || '', images: Array.isArray(r.images) ? r.images : [],
    price: r.price, mrp: r.mrp,
    isVeg: r.isVeg, isEggless: !!r.isEggless, isSugarFree: !!r.isSugarFree, isJain: !!r.isJain, spiceLevel: r.spiceLevel || 'none',
    isBestseller: !!r.isBestseller, isNewArrival: !!r.isNewArrival, isGiftPack: !!r.isGiftPack,
    serves: r.serves, calories: r.calories, prepTimeMin: r.prepTimeMin, maxPerOrder: r.maxPerOrder ?? undefined,
    optionGroups: (r.optionGroups || []).map((g) => ({ ...g, options: (g.options || []).map((o) => ({ ...o })) })),
    isActive: r.isActive !== false,
    itemKind: r.itemKind || '', sellBy: r.sellBy || 'piece',
    measure: { options: r.measure?.options || [], min: r.measure?.min, allowManual: r.measure?.allowManual !== false },
});

// -> { field: 'message' }; empty = fine
export function itemProblems(v) {
    const e = {};
    if (!v.categoryId && !v.newCategory.trim() && !v.itemKind) e.categoryId = 'Pick a category (or what kind of item it is)';
    if (v.newCategory.trim() && (v.newCategory.trim().length < 2 || v.newCategory.trim().length > 40)) e.newCategory = 'A category name is 2 to 40 letters';
    if (v.sellBy !== 'piece' && v.measure.min !== undefined && v.measure.min < 10) e.measure = 'The smallest amount is at least 10';
    if (!v.name.trim()) e.name = 'Enter the item name';
    if (v.price === undefined || v.price < 0) e.price = 'Enter the price';
    if (typeof v.isVeg !== 'boolean') e.isVeg = 'Choose veg or non-veg';
    if (v.mrp !== undefined && v.price !== undefined && v.mrp < v.price) e.mrp = 'MRP cannot be lower than the price';
    if (v.isJain && v.isVeg === false) e.isJain = 'A Jain item must be veg';
    if (v.maxPerOrder !== undefined && (!Number.isInteger(v.maxPerOrder) || v.maxPerOrder < 1 || v.maxPerOrder > 20)) e.maxPerOrder = 'The most per order is a whole number from 1 to 20';
    v.optionGroups.forEach((g, i) => {
        if (!g.name.trim()) e.optionGroups = `Choice group ${i + 1} needs a question`;
        else if (!g.options.length || g.options.some((o) => !o.name.trim())) e.optionGroups = `Choice group ${i + 1}: every option needs a name`;
    });
    return e;
}

export const itemBody = (v) => ({
    // a typed new category wins: the server reuses the shop's category of that name, or creates it
    ...(v.newCategory.trim() ? { categoryName: v.newCategory.trim() } : v.categoryId ? { categoryId: v.categoryId } : {}),
    ...(v.itemKind ? { itemKind: v.itemKind } : {}),
    sellBy: v.sellBy,
    ...(v.sellBy !== 'piece' ? { measure: { options: v.measure.options, min: v.measure.min ?? undefined, allowManual: v.measure.allowManual } } : {}),
    name: v.name.trim(),
    description: v.description.trim(),
    image: v.image || '',
    images: v.image ? (v.images || []) : [],   // the extra pictures need a main one
    price: v.price,
    mrp: v.mrp ?? null,
    isVeg: v.isVeg,
    isEggless: v.isEggless,
    isSugarFree: v.isSugarFree,
    isJain: v.isJain,
    spiceLevel: v.spiceLevel,
    isBestseller: v.isBestseller,
    isNewArrival: v.isNewArrival,
    isGiftPack: v.isGiftPack,
    serves: v.serves ?? null,
    calories: v.calories ?? null,
    prepTimeMin: v.prepTimeMin ?? null,
    maxPerOrder: v.maxPerOrder ?? null,
    optionGroups: withIds(v.optionGroups),
    isActive: v.isActive,
});

/* ------------------------------ what a menu row says about an item ------------------------------ */
// -> 'on' | 'off' | 'timed' | 'stock'   (timed = off until a set time; stock = counted and nothing left)
export function itemState(p, now = Date.now()) {
    if (p.stock?.enabled && !(p.stock.qty > 0)) return 'stock';
    if (p.isAvailable !== false) return 'on';
    if (p.unavailableUntil && new Date(p.unavailableUntil).getTime() > now) return 'timed';
    return 'off';
}
