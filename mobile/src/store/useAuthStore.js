import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'refreshToken';
const USER_KEY = 'user';

const clearStoredSession = async () => {
    try {
        await SecureStore.deleteItemAsync(REFRESH_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
    } catch (e) { }
};

export const useAuthStore = create((set, get) => ({
    user: null,
    accessToken: null, // memory only, never persisted
    isHydrated: false, // true once we've checked SecureStore on app start

    // Called by LoginScreen after a successful OTP verify
    login: async (user, accessToken, refreshToken) => {
        await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
        set({ user, accessToken });
    },

    // Clears local session first (so UI updates instantly), then tells the
    // server to delete the session (best effort, errors ignored).
    logout: async () => {
        let refreshToken = null;
        try {
            refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
        } catch (e) { }

        await clearStoredSession();
        set({ user: null, accessToken: null });

        if (refreshToken) {
            try {
                // required lazily to avoid a circular import with api/client.js
                const api = require('../api/client').default;
                api.post('/auth/logout', { refreshToken }).catch(() => { });
            } catch (e) { }
        }
    },

    setAccessToken: (accessToken) => set({ accessToken }),

    // Called once on app start (by AppNavigator).
    // Restores the saved user immediately so the app opens fast, then
    // refreshes the access token in the background.
    hydrate: async () => {
        if (get().isHydrated) return;
        try {
            const [refreshToken, userJson] = await Promise.all([
                SecureStore.getItemAsync(REFRESH_KEY),
                SecureStore.getItemAsync(USER_KEY),
            ]);

            if (!refreshToken || !userJson) {
                await clearStoredSession(); // never keep half a session
                set({ isHydrated: true });
                return;
            }

            const user = JSON.parse(userJson);
            set({ user, isHydrated: true });

            // Background refresh. Only a definite rejection (401/403) logs out;
            // being offline keeps the user signed in.
            const { refreshSession } = require('../api/client');
            refreshSession().catch(async (e) => {
                if (e && e.fatal) await get().logout();
            });
        } catch (e) {
            // corrupted storage or JSON: start clean at the login screen
            await clearStoredSession();
            set({ user: null, accessToken: null, isHydrated: true });
        }
    },
}));