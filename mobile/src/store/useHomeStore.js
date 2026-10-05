import { create } from 'zustand';
import { fetchConfig, fetchCategories, fetchBanners, fetchOffers } from '../api/catalogApi';
import { readCache, writeCache } from '../utils/cache';

const DEFAULT_CONFIG = {
    blocks: ['search', 'banner', 'categories', 'filters', 'offers', 'items'],
    filters: [],
    sortOptions: ['popularity'],
    cardStyle: 'big',
    showVegDot: false,
    foodMode: 'mixed',
};

export const useHomeStore = create((set, get) => ({
    config: DEFAULT_CONFIG,
    delivery: null,
    categories: [],
    banners: [],
    offers: [],

    async load() {
        // 1) show the saved copy instantly
        const cached = await readCache('home');
        if (cached) set(cached);

        // 2) refresh from the server
        try {
            const [cfg, cats, ban, off] = await Promise.allSettled([
                fetchConfig(), fetchCategories(), fetchBanners(), fetchOffers(),
            ]);
            if (cfg.status !== 'fulfilled') throw cfg.reason;

            const fresh = {
                config: { ...DEFAULT_CONFIG, ...cfg.value.homeConfig },
                delivery: cfg.value.delivery,
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