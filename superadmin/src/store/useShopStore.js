import { create } from 'zustand';
import { fetchShop, fetchLive } from '../api/shopsApi';
import { errMsg } from '../api/adminClient';

// One shop's full record, kept by id so going back to a shop is instant and then refreshes quietly.
export const useShopStore = create((set, get) => ({
    byId: {},        // id -> { tenant, resolved, state }
    live: {},        // id -> live snapshot
    errors: {},

    async load(id, { quiet = false } = {}) {
        if (!quiet) set({ errors: { ...get().errors, [id]: null } });
        try {
            const r = await fetchShop(id);
            set({ byId: { ...get().byId, [id]: r } });
            return r;
        } catch (e) {
            set({ errors: { ...get().errors, [id]: errMsg(e) } });
            return null;
        }
    },

    async loadLive(id) {
        const r = await fetchLive(id);
        set({ live: { ...get().live, [id]: r } });
        return r;
    },

    // use the answer of a save so the screen is right without another call
    setTenant(id, tenant, state) {
        const cur = get().byId[id] || {};
        set({ byId: { ...get().byId, [id]: { ...cur, tenant, ...(state ? { state } : {}) } } });
    },
}));
