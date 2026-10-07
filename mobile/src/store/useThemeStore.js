// src/store/useThemeStore.js
import { create } from 'zustand';
import api from '../api/client';

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
        heroImages: [
            require('../assets/tenants/savera/hero-1.png'),
            require('../assets/tenants/savera/hero-2.png'),
            require('../assets/tenants/savera/hero-3.png'),
        ],
    },

    setTheme: (newTheme) => set((state) => ({
        theme: {
            ...state.theme,
            ...newTheme,
            colors: { ...state.theme.colors, ...(newTheme.colors || {}) },
        },
    })),

    loadTheme: async () => {
        try {
            const { data } = await api.get('/tenants/theme');
            const { heroImages, ...rest } = data;
            // an empty list from the server must not wipe the fallback images
            get().setTheme({ ...rest, ...(heroImages?.length ? { heroImages } : {}) });
        } catch (e) { }
    },
}));