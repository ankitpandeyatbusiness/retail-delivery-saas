import { create } from 'zustand';

export const useFilterStore = create((set) => ({
    category: null,   // category id chip
    active: [],       // ids: veg_only, egg_free, rating_4, offers, bestseller, sugar_free, jain, gift_pack, new
    sort: null,       // popularity, price_low, price_high, rating, prep_time, newest
    price: 0,         // 0 none, 1 under 150, 2 150-300, 3 above 300
    spice: null,      // mild | medium | hot
    serves: null,     // number
    weight: null,     // weight option id

    setCategory: (id) => set((s) => ({ category: s.category === id ? null : id })),
    toggleFilter: (id) => set((s) => ({ active: s.active.includes(id) ? s.active.filter((x) => x !== id) : [...s.active, id] })),
    setSort: (sort) => set({ sort }),
    setPrice: (p) => set((s) => ({ price: s.price === p ? 0 : p })),
    setSpice: (v) => set((s) => ({ spice: s.spice === v ? null : v })),
    setServes: (v) => set((s) => ({ serves: s.serves === v ? null : v })),
    setWeight: (v) => set((s) => ({ weight: s.weight === v ? null : v })),
    clear: () => set({ active: [], sort: null, price: 0, spice: null, serves: null, weight: null }),
}));

export const countActive = (f) =>
    f.active.length + (f.price ? 1 : 0) + (f.spice ? 1 : 0) + (f.serves ? 1 : 0) + (f.weight ? 1 : 0) +
    (f.sort && f.sort !== 'popularity' ? 1 : 0);

const SORTERS = {
    price_low: (a, b) => a.price - b.price,
    price_high: (a, b) => b.price - a.price,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    prep_time: (a, b) => (a.prepTimeMin || 999) - (b.prepTimeMin || 999),
    newest: (a, b) => String(b._id).localeCompare(String(a._id)),
};

// Same rules as the server filters. Unknown ids are ignored.
export function applyFilters(items, f, minCount = 5) {
    const L = items.filter((p) => {
        if (f.category && String(p.categoryId) !== f.category) return false;
        for (const id of f.active) {
            if (id === 'veg_only' && !p.isVeg) return false;
            if (id === 'egg_free' && !p.isEggless) return false;
            if (id === 'sugar_free' && !p.isSugarFree) return false;
            if (id === 'jain' && !p.isJain) return false;
            if (id === 'bestseller' && !p.isBestseller) return false;
            if (id === 'gift_pack' && !p.isGiftPack) return false;
            if (id === 'new' && !p.isNewArrival) return false;
            if (id === 'offers' && !(p.mrp > p.price)) return false;
            if (id === 'rating_4' && !(p.rating >= 4 && (p.ratingCount || 0) >= minCount)) return false;
        }
        if (f.price === 1 && !(p.price < 150)) return false;
        if (f.price === 2 && !(p.price >= 150 && p.price <= 300)) return false;
        if (f.price === 3 && !(p.price > 300)) return false;
        if (f.spice && p.spiceLevel !== f.spice) return false;
        if (f.serves && !(p.serves >= f.serves)) return false;
        if (f.weight && !(p.optionGroups || []).some((g) => g.id === 'weight' && g.options.some((o) => o.id === f.weight))) return false;
        return true;
    });
    return SORTERS[f.sort] ? L.sort(SORTERS[f.sort]) : L;
}