// Items sold by weight or volume. The item's price is per 1 kg (1 L); the customer picks an amount in g (ml).
// The server works out the real price: this file only draws the same numbers for the screen.
export const isMeasured = (p) => p?.sellBy === 'weight' || p?.sellBy === 'volume';

const UNITS = { weight: ['g', 'kg'], volume: ['ml', 'L'] };
export const perUnit = (p) => (p?.sellBy === 'volume' ? '/L' : '/kg');

// 250 -> "250 g", 1500 -> "1.5 kg"
export function amountLabel(sellBy, qty) {
    const [small, big] = UNITS[sellBy] || UNITS.weight;
    return qty >= 1000 ? `${Math.round(qty) / 1000} ${big}` : `${qty} ${small}`;
}

// the amounts this item offers
export function measureRules(p) {
    const m = p.measure || {};
    const options = Array.isArray(m.options) && m.options.length ? [...m.options] : [250, 500, 1000];
    return {
        options: [...new Set(options)].sort((a, b) => a - b),
        min: m.min || 50,
        max: m.max || 50000,
        step: m.step || 50,
        allowManual: m.allowManual !== false,
    };
}

export const packPrice = (p, qty) => Math.round(((p.price * qty) / 1000 + Number.EPSILON) * 100) / 100;

// "/kg" or "/L" after the price on cards
export const priceSuffix = (p) => (isMeasured(p) ? perUnit(p) : '');

// the amount to start with: what is already in the cart, else 500 g (or the middle offered amount)
export function startAmount(p, inCartQty) {
    const r = measureRules(p);
    if (inCartQty) return inCartQty;
    return r.options.includes(500) ? 500 : r.options[Math.floor(r.options.length / 2)] || r.min;
}
