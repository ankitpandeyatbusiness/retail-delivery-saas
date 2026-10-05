export const FILTERS = {
    veg_only: { label: 'Veg', params: { veg: true } },
    egg_free: { label: 'Eggless', params: { eggFree: true } },
    rating_4: { label: 'Rating 4+', params: { minRating: 4 } },
    bestseller: { label: 'Bestseller', params: { bestseller: true } },
    sugar_free: { label: 'Sugar free', params: { sugarFree: true } },
    jain: { label: 'Jain', params: { jain: true } },
    gift_pack: { label: 'Gift packs', params: { giftPack: true } },
    new: { label: 'New', params: { newArrival: true } },
};

export const SORT_LABELS = {
    popularity: 'Popular',
    price_low: 'Price: low to high',
    price_high: 'Price: high to low',
    rating: 'Rating',
    prep_time: 'Fastest',
    newest: 'Newest',
};