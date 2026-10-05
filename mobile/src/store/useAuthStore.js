import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

export const useAuthStore = create((set) => ({
    user: null,
    accessToken: null,
    isHydrated: false, // Tracks if we've loaded tokens from storage on boot

    login: async (user, accessToken, refreshToken) => {
        await SecureStore.setItemAsync('refreshToken', refreshToken);
        set({ user, accessToken });
    },

    logout: async () => {
        await SecureStore.deleteItemAsync('refreshToken');
        set({ user: null, accessToken: null });
    },

    setAccessToken: (accessToken) => set({ accessToken }),

    hydrate: async () => {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        // We don't store accessToken in SecureStore long-term, we'll refresh it on boot if needed.
        set({ isHydrated: true });
        return refreshToken;
    }
}));