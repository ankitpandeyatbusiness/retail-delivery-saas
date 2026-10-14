// What kind of business a shop is. Only "restaurant" is open today; the others are placeholders so the
// platform can grow (general store, stationery, garments...) without reshaping the data later.
//
// A business type owns:
//   itemKinds : what an item can be (Sweet, Food, Drink...). Each kind starts "sold by" piece, weight or volume
//               and names the menu category the item is filed under automatically.
//   measures  : the quick-pick sizes for items sold by weight (grams) or volume (ml)
const MEASURE_LIMITS = { minQty: 10, maxQty: 50000 };   // grams / ml

const BUSINESS_TYPES = {
    restaurant: {
        label: 'Restaurant',
        status: 'active',
        itemKinds: [
            { id: 'food', label: 'Food', sellBy: 'piece', category: 'Food' },
            { id: 'sweet', label: 'Sweet', sellBy: 'weight', category: 'Sweets' },
            { id: 'drink', label: 'Drink', sellBy: 'piece', category: 'Drinks' },
            { id: 'snack', label: 'Snack', sellBy: 'piece', category: 'Snacks' },
            { id: 'bakery', label: 'Bakery', sellBy: 'piece', category: 'Bakery' },
            { id: 'dairy', label: 'Dairy', sellBy: 'piece', category: 'Dairy' },
            { id: 'other', label: 'Other', sellBy: 'piece', category: 'Other' },
        ],
        measures: {
            weight: { unit: 'g', presets: [100, 250, 500, 1000, 2000], defaultMin: 50, defaultStep: 50 },
            volume: { unit: 'ml', presets: [100, 250, 500, 1000, 2000], defaultMin: 50, defaultStep: 50 },
        },
    },
    // placeholders: not selectable yet
    general_store: { label: 'General store', status: 'planned', itemKinds: [], measures: {} },
    stationery: { label: 'Stationery', status: 'planned', itemKinds: [], measures: {} },
    garments: { label: 'Garments', status: 'planned', itemKinds: [], measures: {} },
};

const DEFAULT_BUSINESS_TYPE = 'restaurant';
const SELL_BY = ['piece', 'weight', 'volume'];

const typeOf = (id) => BUSINESS_TYPES[id] || BUSINESS_TYPES[DEFAULT_BUSINESS_TYPE];
const kindOf = (businessType, kindId) => typeOf(businessType).itemKinds.find((k) => k.id === kindId) || null;

module.exports = { BUSINESS_TYPES, DEFAULT_BUSINESS_TYPE, SELL_BY, MEASURE_LIMITS, typeOf, kindOf };
