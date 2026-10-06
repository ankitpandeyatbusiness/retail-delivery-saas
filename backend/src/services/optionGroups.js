// Option groups = what Zomato/Swiggy show as "Choose size", "Add extras", "Milk type".
// A group has min/max picks:  min 1 + max 1 = required, pick one
//                             min 0 + max 3 = optional, up to 3
// Option price is an EXTRA added on top of the product's base price.

const ID_RE = /^[a-z0-9_-]{1,30}$/;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// Returns a list of readable error messages (empty list = valid)
function validateOptionGroups(groups) {
    const errors = [];
    if (!Array.isArray(groups)) return ['optionGroups must be a list'];
    if (groups.length > 8) errors.push('optionGroups: at most 8 groups per item');

    const groupIds = new Set();
    groups.forEach((g, i) => {
        const p = `optionGroups[${i}]`;
        if (!g || typeof g !== 'object') return errors.push(`${p}: invalid`);

        if (!ID_RE.test(g.id || '')) errors.push(`${p}.id: use lowercase letters, numbers, - or _ (max 30)`);
        else if (groupIds.has(g.id)) errors.push(`${p}.id: "${g.id}" is used twice`);
        else groupIds.add(g.id);

        if (!g.name || !String(g.name).trim() || String(g.name).length > 40) errors.push(`${p}.name: required, max 40 characters`);

        const opts = Array.isArray(g.options) ? g.options : [];
        if (!opts.length) errors.push(`${p}.options: add at least one option`);
        if (opts.length > 30) errors.push(`${p}.options: at most 30 options`);

        const min = g.min ?? 0;
        const max = g.max ?? 1;
        if (!Number.isInteger(min) || min < 0) errors.push(`${p}.min: must be 0 or more`);
        if (!Number.isInteger(max) || max < 1 || max > Math.max(opts.length, 1)) errors.push(`${p}.max: must be between 1 and the number of options`);
        if (Number.isInteger(min) && Number.isInteger(max) && min > max) errors.push(`${p}: min cannot be more than max`);

        const optionIds = new Set();
        opts.forEach((o, k) => {
            const op = `${p}.options[${k}]`;
            if (!ID_RE.test(o?.id || '')) errors.push(`${op}.id: use lowercase letters, numbers, - or _ (max 30)`);
            else if (optionIds.has(o.id)) errors.push(`${op}.id: "${o.id}" is used twice`);
            else optionIds.add(o.id);
            if (!o?.name || !String(o.name).trim() || String(o.name).length > 40) errors.push(`${op}.name: required, max 40 characters`);
            if (o?.price !== undefined && (typeof o.price !== 'number' || o.price < 0 || o.price > 10000)) errors.push(`${op}.price: must be a number from 0 to 10000`);
        });
        if (opts.filter((o) => o?.isDefault).length > max) errors.push(`${p}: more default options than max`);
    });
    return errors;
}

// Checks what the customer picked against the item's rules and returns the real price.
// The app may show its own total, but the server ALWAYS uses this one (cart/order code will call it).
// selections = [{ groupId: 'size', optionIds: ['large'] }, ...]
function priceSelection(product, selections = []) {
    const groups = product.optionGroups || [];
    if (!Array.isArray(selections)) throw bad('Invalid selection');

    const picked = new Map();
    for (const s of selections) {
        if (!s || typeof s.groupId !== 'string' || !Array.isArray(s.optionIds)) throw bad('Invalid selection');
        if (picked.has(s.groupId)) throw bad('Same option group sent twice');
        if (!groups.some((g) => g.id === s.groupId)) throw bad('Unknown option group');
        picked.set(s.groupId, [...new Set(s.optionIds.map(String))]);
    }

    let unitPrice = product.price;
    const chosen = [];
    for (const g of groups) {
        const ids = picked.get(g.id) || [];
        const min = g.min ?? 0;
        const max = g.max ?? 1;
        if (ids.length < min) throw bad(`Please choose ${min === 1 ? 'one option' : `at least ${min}`} for "${g.name}"`);
        if (ids.length > max) throw bad(`Choose at most ${max} for "${g.name}"`);
        for (const oid of ids) {
            const o = g.options.find((x) => x.id === oid);
            if (!o) throw bad(`Unknown option for "${g.name}"`);
            if (o.isAvailable === false) throw bad(`"${o.name}" is not available right now`);
            unitPrice += o.price || 0;
            chosen.push({ groupId: g.id, groupName: g.name, optionId: o.id, name: o.name, price: o.price || 0 });
        }
    }
    return { unitPrice, chosen };
}

module.exports = { validateOptionGroups, priceSelection };