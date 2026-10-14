// Items sold by weight (sweets, halwa) or by volume (drinks).
//   product.price  = price of ONE kg (or one litre) for these items
//   the customer picks an amount in grams / ml, from the shop's quick sizes or typed by hand
//   there is no "quantity" and no "serves"/size for them: the amount IS the quantity
const { MEASURE_LIMITS, typeOf } = require('../config/businessTypes');

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const unitOf = (sellBy) => (sellBy === 'volume' ? 'ml' : 'g');

// 250 -> "250 g", 1500 -> "1.5 kg", 2000 -> "2 kg" (ml and L for volume)
function labelOf(sellBy, qty) {
    const big = unitOf(sellBy) === 'ml' ? 'L' : 'kg';
    const small = unitOf(sellBy);
    if (qty >= 1000) return `${Math.round((qty / 1000) * 1000) / 1000} ${big}`;
    return `${qty} ${small}`;
}

// The rules of one item, with defaults filled in. product.measure may be partial.
function rulesOf(product, businessType) {
    const m = product.measure || {};
    const def = typeOf(businessType).measures[product.sellBy] || { presets: [250, 500, 1000], defaultMin: 50, defaultStep: 50 };
    const options = Array.isArray(m.options) && m.options.length ? m.options : def.presets;
    return {
        options: [...new Set(options)].sort((a, b) => a - b),
        min: m.min || def.defaultMin,
        max: m.max || MEASURE_LIMITS.maxQty,
        step: m.step || def.defaultStep,
        allowManual: m.allowManual !== false,
    };
}

// Errors (as text) in what the shop typed for an item. Empty list = fine.
function validateMeasureInput(p, businessType) {
    const errors = [];
    if (!['piece', 'weight', 'volume'].includes(p.sellBy || 'piece')) errors.push('sellBy must be piece, weight or volume');
    if ((p.sellBy || 'piece') === 'piece') return errors;
    const m = p.measure || {};
    const lim = (v, name, lo, hi) => {
        if (v === undefined || v === null) return;
        if (!Number.isInteger(v) || v < lo || v > hi) errors.push(`${name} must be a whole number from ${lo} to ${hi}`);
    };
    lim(m.min, 'Smallest amount', MEASURE_LIMITS.minQty, MEASURE_LIMITS.maxQty);
    lim(m.max, 'Largest amount', MEASURE_LIMITS.minQty, MEASURE_LIMITS.maxQty);
    lim(m.step, 'Step', 1, 5000);
    if (m.options !== undefined) {
        if (!Array.isArray(m.options) || m.options.length > 12) errors.push('Quick sizes: at most 12');
        else m.options.forEach((o) => lim(o, 'Quick size', MEASURE_LIMITS.minQty, MEASURE_LIMITS.maxQty));
    }
    const r = rulesOf(p, businessType);
    if (r.min > r.max) errors.push('Smallest amount cannot be more than the largest');
    if (!r.options.length && r.allowManual === false) errors.push('Add at least one quick size, or allow typing an amount');
    if (!(p.price > 0)) errors.push(`Enter the price per ${p.sellBy === 'volume' ? 'litre' : 'kg'}`);
    return errors;
}

// What the customer asked for -> the real price of that pack
function priceMeasure(product, qty, businessType) {
    const sellBy = product.sellBy;
    if (!Number.isInteger(qty)) throw bad(`Choose how much of "${product.name}" you want`);
    const r = rulesOf(product, businessType);
    if (qty < r.min) throw bad(`"${product.name}": the smallest amount is ${labelOf(sellBy, r.min)}`);
    if (qty > r.max) throw bad(`"${product.name}": the largest amount is ${labelOf(sellBy, r.max)}`);
    if (!r.options.includes(qty)) {
        if (!r.allowManual) throw bad(`"${product.name}": choose one of the listed sizes`);
        if ((qty - r.min) % r.step !== 0 && qty % r.step !== 0) throw bad(`"${product.name}": amounts go in steps of ${labelOf(sellBy, r.step)}`);
    }
    return { qty, unit: unitOf(sellBy), label: labelOf(sellBy, qty), unitPrice: round2((product.price * qty) / 1000) };
}

module.exports = { rulesOf, validateMeasureInput, priceMeasure, labelOf, unitOf };
