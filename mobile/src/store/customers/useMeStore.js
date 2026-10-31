// The customer's own account details (name, photo, email, promotions switch), kept on the phone and loaded in the background as soon as the app opens,
// so the Account screen has them on its first frame (no jump, no loading).
import { create } from 'zustand';
import { Image } from 'expo-image';
import { readCache, writeCache } from '../../utils/common/cache';
import { fetchMe } from '../../api/customers/shopApi';

const KEY = 'accountMe';

export const useMeStore = create((set, get) => ({
    me: null,
    hydrate: async () => {
        if (get().me) return;
        const c = await readCache(KEY);
        if (c && !get().me) set({ me: c });
    },
    refresh: async () => {
        try {
            const u = await fetchMe();
            set({ me: u });
            writeCache(KEY, u);
            if (u?.avatarUrl) Image.prefetch(u.avatarUrl).catch(() => { });   // the picture is ready before the screen opens
        } catch (e) { /* what is kept stays */ }
    },
    // a change made on the screen (value or function of the old one)
    setMe: (next) => { const me = typeof next === 'function' ? next(get().me) : next; set({ me }); writeCache(KEY, me); },
    clear: () => { set({ me: null }); writeCache(KEY, null); },
}));

useMeStore.getState().hydrate();   // starts reading as soon as the app loads
