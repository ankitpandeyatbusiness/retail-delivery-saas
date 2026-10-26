import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const KEY = 'rc_session';

// The token is a JWT: read its expiry so an old one is dropped at start-up instead of failing the first call.
const expiryOf = (token) => {
    try {
        const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(global.atob(part)).exp * 1000;
    } catch (e) { return null; }
};

export const useAuthStore = create((set) => ({
    token: null,
    admin: null,
    hydrated: false,
    notice: null,   // shown once on the login screen (for example "session ended")

    hydrate: async () => {
        try {
            const raw = await SecureStore.getItemAsync(KEY);
            if (raw) {
                const s = JSON.parse(raw);
                const exp = expiryOf(s.token);
                if (s.token && (!exp || exp > Date.now() + 60000)) {
                    set({ token: s.token, admin: s.admin || null });
                } else {
                    await SecureStore.deleteItemAsync(KEY);
                }
            }
        } catch (e) { /* unreadable storage: start logged out */ }
        set({ hydrated: true });
    },

    login: async (token, admin) => {
        try { await SecureStore.setItemAsync(KEY, JSON.stringify({ token, admin })); } catch (e) { }
        set({ token, admin, notice: null });
    },

    // the server sent a fresh token for the same admin: keep it, so the login does not run out while the app is in use
    renew: async (token) => {
        const { admin } = useAuthStore.getState();
        try { await SecureStore.setItemAsync(KEY, JSON.stringify({ token, admin })); } catch (e) { }
        set({ token });
    },

    logout: async (notice = null) => {
        // forget this phone's push address while the login still works (best effort)
        try { await require('../utils/push').disablePush(); } catch (e) { /* ignore */ }
        try { await SecureStore.deleteItemAsync(KEY); } catch (e) { }
        set({ token: null, admin: null, notice });
    },

    clearNotice: () => set({ notice: null }),
}));
