import { create } from 'zustand';
import { fetchOptions } from '../api/shopsApi';
import { errMsg } from '../api/adminClient';

// Every allowed value, the defaults and the shop-type templates. They do not change while the app runs: load once.
export const useOptionsStore = create((set, get) => ({
    options: null,
    defaults: null,
    presets: null,
    error: null,
    loading: false,

    async load() {
        if (get().options || get().loading) return;
        set({ loading: true, error: null });
        try {
            const r = await fetchOptions();
            set({ options: r.options, defaults: r.defaults, presets: r.presets, loading: false });
        } catch (e) {
            set({ error: errMsg(e), loading: false });
        }
    },
}));
