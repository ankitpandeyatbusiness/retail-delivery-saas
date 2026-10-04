// src/store/useThemeStore.js
import { create } from 'zustand';

export const useThemeStore = create((set) => ({
    // These are the fallback values. 
    // When the app boots, it will fetch the tenant JSON from MongoDB and overwrite these.
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
        heroImages: [
            // Fallback remote URLs so the app never crashes if the network request fails
            require('../assets/tenants/savera/hero-1.png'),
            require('../assets/tenants/savera/hero-2.png'),
            require('../assets/tenants/savera/hero-3.png'),
        ],
    },

    // Deep merge to ensure that if the backend omits a color, the fallback is still used
    setTheme: (newTheme) => set((state) => ({
        theme: {
            ...state.theme,
            ...newTheme,
            colors: {
                ...state.theme.colors,
                ...(newTheme.colors || {}),
            },
        }
    })),
}));