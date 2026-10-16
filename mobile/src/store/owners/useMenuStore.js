// The owner's menu: every category (hidden ones too) and light items, loaded in one call. Switches and stock steppers
// change the row at once and are put back if the server says no.
import { create } from 'zustand';
import { fetchMenu, fetchMenuOptions, setAvailability, setStock, reorder, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from './useOwnerStore';

let seq = 0;

export const useMenuStore = create((set, get) => ({
    categories: [],
    products: [],
    options: null,      // item kinds + quick sizes for this kind of shop (loaded once)
    truncated: false,
    loading: true,
    refreshing: false,
    error: null,
    loadedAt: 0,

    load: async ({ quiet = false } = {}) => {
        const mine = ++seq;
        set(quiet ? { refreshing: true } : { loading: !get().loadedAt, refreshing: !!get().loadedAt });
        try {
            const m = await fetchMenu();
            if (mine !== seq) return;
            set({ categories: m.categories || [], products: m.products || [], truncated: !!m.truncated, loading: false, refreshing: false, error: null, loadedAt: Date.now() });
        } catch (e) {
            if (mine !== seq) return;
            useOwnerStore.getState().noteError(e);
            set({ loading: false, refreshing: false, error: apiError(e, 'Could not load the menu. Pull down to try again.') });
        }
    },

    loadOptions: async () => {
        if (get().options) return get().options;
        try {
            const o = await fetchMenuOptions();
            set({ options: o });
            return o;
        } catch (e) { useOwnerStore.getState().noteError(e); return null; }
    },

    patchProduct: (id, patch) => set((st) => ({ products: st.products.map((p) => (String(p._id) === String(id) ? { ...p, ...patch } : p)) })),

    // body as for setAvailability. Throws the server's words when it refuses (the row is put back).
    setAvailable: async (id, body) => {
        const before = get().products.find((p) => String(p._id) === String(id));
        if (!before) return;
        get().patchProduct(id, { isAvailable: body.available, ...(body.available ? { unavailableUntil: null } : {}) });
        try {
            const r = await setAvailability(id, body);
            get().patchProduct(id, { isAvailable: r.isAvailable, unavailableUntil: r.unavailableUntil });
        } catch (e) {
            get().patchProduct(id, { isAvailable: before.isAvailable, unavailableUntil: before.unavailableUntil });
            useOwnerStore.getState().noteError(e);
            throw new Error(apiError(e));
        }
    },

    // body { enabled?, qty?, dailyQty? }
    changeStock: async (id, body) => {
        const before = get().products.find((p) => String(p._id) === String(id));
        if (!before) return;
        if (body.qty !== undefined) get().patchProduct(id, { stock: { ...before.stock, enabled: true, qty: body.qty } });
        try {
            const r = await setStock(id, body);
            get().patchProduct(id, { stock: r.stock, isAvailable: r.isAvailable, unavailableUntil: null });
        } catch (e) {
            get().patchProduct(id, { stock: before.stock, isAvailable: before.isAvailable });
            useOwnerStore.getState().noteError(e);
            throw new Error(apiError(e));
        }
    },

    // ids in the new order. kind: categories | products
    saveOrder: async (kind, ids) => {
        const key = kind === 'categories' ? 'categories' : 'products';
        const before = get()[key];
        const pos = new Map(ids.map((id, i) => [String(id), i]));
        set({ [key]: [...before].sort((a, b) => (pos.has(String(a._id)) ? pos.get(String(a._id)) : 1e9) - (pos.has(String(b._id)) ? pos.get(String(b._id)) : 1e9)) });
        try { await reorder(kind, ids); } catch (e) {
            set({ [key]: before });
            useOwnerStore.getState().noteError(e);
            throw new Error(apiError(e));
        }
    },

    reset: () => set({ categories: [], products: [], options: null, truncated: false, loading: true, refreshing: false, error: null, loadedAt: 0 }),
}));
