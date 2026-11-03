// Is this owner a BRAND owner, and which branches does the brand have? Asked once per start; a shop without branches (or an owner who is
// only a branch manager) gets "no" and the branch screens never show up.
import { create } from 'zustand';
import { fetchBrandMe } from '../../api/owners/brandApi';

export const useBrandStore = create((set, get) => ({
    loaded: false,
    me: null,   // null = not a brand owner
    load: async (force = false) => {
        if (get().loaded && !force) return;
        try {
            const me = await fetchBrandMe();
            set({ me, loaded: true });
        } catch (e) {
            // 403 = not a brand owner (the normal answer for most shops). Anything else (offline): ask again next time.
            if (e && e.response && e.response.status) set({ me: null, loaded: true });
        }
    },
    reset: () => set({ loaded: false, me: null }),
}));
