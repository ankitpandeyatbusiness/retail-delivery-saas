import { create } from 'zustand';
import { fetchShops } from '../api/shopsApi';
import { errMsg } from '../api/adminClient';

// The server returns up to 200 shops (newest first). Search goes to the server; the filter chips work on the list.
export const useShopsStore = create((set, get) => ({
    items: [],
    loading: false,
    refreshing: false,
    error: null,
    loaded: false,

    async load({ q = '', refresh = false } = {}) {
        set(refresh ? { refreshing: true } : { loading: true, error: null });
        try {
            const { items } = await fetchShops(q.trim());
            set({ items, loaded: true, error: null });
        } catch (e) {
            set({ error: errMsg(e) });
        } finally {
            set({ loading: false, refreshing: false });
        }
    },

    // after an edit / create elsewhere: keep the list row in step without a full reload
    patch(id, fields) {
        set({ items: get().items.map((s) => (s._id === id ? { ...s, ...fields } : s)) });
    },
    add(shop) {
        set({ items: [shop, ...get().items.filter((s) => s._id !== shop._id)] });
    },
}));

export const FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Taking orders' },
    { value: 'attention', label: 'Needs attention' },
    { value: 'suspended', label: 'Suspended' },
];

export const matchesFilter = (shop, f) => {
    if (f === 'open') return shop.state?.acceptingOrders;
    if (f === 'attention') return !shop.state?.acceptingOrders && shop.status === 'active';
    if (f === 'suspended') return shop.status !== 'active';
    return true;
};
