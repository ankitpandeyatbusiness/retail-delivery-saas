import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY = 'rc_theme_mode';

// 'system' follows the phone; 'light' / 'dark' are the user's own choice.
export const useThemeStore = create((set) => ({
    mode: 'system',
    hydrate: async () => {
        try {
            const m = await SecureStore.getItemAsync(KEY);
            if (m === 'light' || m === 'dark' || m === 'system') set({ mode: m });
        } catch (e) { /* keep following the phone */ }
    },
    setMode: async (mode) => {
        set({ mode });
        try { await SecureStore.setItemAsync(KEY, mode); } catch (e) { }
    },
}));
