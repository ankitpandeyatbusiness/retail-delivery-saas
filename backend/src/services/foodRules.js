// Returns a plain-English problem, or null if the item is fine
function foodRuleError(foodMode, p) {
    if (typeof p.isVeg !== 'boolean') return 'Choose veg or non-veg for this item';
    if (p.isJain && !p.isVeg) return 'A Jain item must be veg';
    if (foodMode === 'veg' && !p.isVeg) return 'This is a veg-only shop: non-veg items are not allowed';
    if (foodMode === 'eggless' && !p.isEggless) return 'This is an eggless shop: every item must be eggless';
    return null;
}
module.exports = { foodRuleError };