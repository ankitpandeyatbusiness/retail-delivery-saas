// src/store/useHomeStore.js
import { create } from 'zustand';
import { fetchConfig, fetchCategories, fetchBanners, fetchOffers } from '../api/catalogApi';
import { readCache, writeCache } from '../utils/cache';

// config = the "home" section (blocks, filters, sortOptions, cardStyle, foodMode, showVegDot...)
const HOME_DEFAULTS = {
    blocks: ['search', 'banner', 'categories', 'filters', 'offers', 'items'],
    filters: [],
    sortOptions: ['popularity'],
    cardStyle: 'big',
    showVegDot: false,
    foodMode: 'mixed',
    shopType: 'restaurant',
    itemOptions: {},
};

// full = every other section of /tenants/config
const FULL_DEFAULTS = {
    tabs: ['home', 'search', 'orders', 'profile'],
    features: {
        ratingBadge: true, prepTime: true, serves: false, calories: false,
        specialInstructions: true, scheduleOrder: false, reorder: true, favourites: false,
        guestBrowsing: true, couponField: true, tips: false, vegToggle: false, vegDot: false,
    },
    menu: { outOfStock: 'dim', groupByCategory: true },
    orders: {
        types: ['delivery'], payments: ['cod'], minOrder: 0,
        deliveryFee: { type: 'free', amount: 0, freeAbove: 0 },
        packagingCharge: 0, gst: { mode: 'none', percent: 0 },
        tipOptions: [], prepTimeMin: 20, acceptingOrders: true,
    },
    labels: {
        addButton: 'Add', orderButton: 'Place order', emptyCart: 'Your cart is empty',
        emptySearch: 'No dishes found', closedMessage: 'We are closed right now',
    },
    offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
    brand: {},
    hours: {},
    restaurant: { isOpen: true, closedReason: null },
    ratings: { minCount: 5 },
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Server value wins; missing parts fall back to defaults. Unknown keys are kept, never crash.
function buildFull(c) {
    const out = {};
    for (const k of Object.keys(FULL_DEFAULTS)) {
        const base = FULL_DEFAULTS[k];
        out[k] = isObj(base) ? { ...base, ...(isObj(c[k]) ? c[k] : {}) } : (Array.isArray(c[k]) ? c[k] : base);
    }
    return out;
}

export const useHomeStore = create((set, get) => ({
    version: null,
    config: HOME_DEFAULTS,
    full: buildFull({}),
    delivery: null,
    categories: [],
    banners: [],
    offers: [],

    async load() {
        // 1) show the saved copy instantly
        const cached = await readCache('home');
        if (cached && cached.full) set(cached);

        // 2) refresh from the server
        try {
            const [cfg, cats, ban, off] = await Promise.allSettled([
                fetchConfig(), fetchCategories(), fetchBanners(), fetchOffers(),
            ]);
            if (cfg.status !== 'fulfilled') throw cfg.reason;
            const c = cfg.value.config;
            if (!c) throw new Error('No config in response');

            const fresh = {
                version: cfg.value.version,
                config: { ...HOME_DEFAULTS, ...(c.home || {}) },
                full: buildFull(c),
                delivery: cfg.value.delivery || null,
                categories: cats.value?.items ?? get().categories,
                banners: ban.value?.items ?? get().banners,
                offers: off.value?.items ?? get().offers,
            };
            set(fresh);
            writeCache('home', fresh);
        } catch (e) {
            // offline or server problem: keep whatever is already on screen
        }
    },
}));