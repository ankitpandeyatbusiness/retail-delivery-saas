// src/store/useThemeStore.js
import { create } from 'zustand';
import { Image } from 'expo-image';
import api from '../../api/common/client';
import { readCache, writeCache } from '../../utils/common/cache';

const THEME_CACHE_KEY = 'theme';

// download the hero images to the phone's disk in the background, so the login screen opens with them ready
const warmHeroImages = (urls) => {
    if (Array.isArray(urls) && urls.length) Image.prefetch(urls, 'disk').catch(() => { });
};

export const useThemeStore = create((set, get) => ({
    // Fallback values. loadTheme() overwrites them with the shop's real theme.
    theme: {
        name: 'Savera',
        tagline: 'Delicious food, delivered to your door',
        colors: {
            primary: '#E23744',
            primaryLight: '#EE4B58',
            primaryDark: '#D42A38',
            background: '#FFFFFF',
            text: '#1C1C1C',
            error: '#C62828',
        },
        fontStyle: 'modern',
        buttonShape: 'rounded',
        // CDN urls from the server (tenants/<slug>/branding/hero/ in the bucket). Nothing is bundled in the app.
        heroImages: [],
    },

    setTheme: (newTheme) => set((state) => ({
        theme: {
            ...state.theme,
            ...newTheme,
            colors: { ...state.theme.colors, ...(newTheme.colors || {}) },
        },
    })),

    // The last theme this phone saw, read from disk. Used at start so the app opens in the shop's own look at once,
    // instead of waiting for the network (or showing another shop's default).
    hydrateFromCache: async () => {
        const saved = await readCache(THEME_CACHE_KEY);
        if (saved) {
            get().setTheme(saved);
            warmHeroImages(saved.heroImages);
        }
    },

    loadTheme: async () => {
        try {
            const { data } = await api.get('/tenants/theme');
            get().setTheme(data);
            writeCache(THEME_CACHE_KEY, data);   // so the next start (even offline) shows the shop's own look
            warmHeroImages(data.heroImages);
        } catch (e) {
            // offline or server error: use the last theme this phone saw
            const saved = await readCache(THEME_CACHE_KEY);
            if (saved) {
                get().setTheme(saved);
                warmHeroImages(saved.heroImages);
            }
        }
    },
}));