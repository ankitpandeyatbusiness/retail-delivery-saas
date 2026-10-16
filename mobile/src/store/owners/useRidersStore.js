// The delivery team: riders (with their live orders) and how much cash each one owes the shop.
import { create } from 'zustand';
import { fetchRiders, fetchCodRiders, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from './useOwnerStore';

let seq = 0;

export const useRidersStore = create((set, get) => ({
    riders: [],
    cash: {},            // riderId -> { balancePaise, collectedPaise, handedPaise, lastAt }
    totalOwedPaise: 0,
    loading: true,
    refreshing: false,
    error: null,
    loadedAt: 0,

    load: async ({ quiet = false } = {}) => {
        const mine = ++seq;
        set(quiet ? { refreshing: !!get().loadedAt } : { loading: !get().loadedAt });
        try {
            const [r, c] = await Promise.allSettled([fetchRiders(), fetchCodRiders()]);
            if (mine !== seq) return;
            if (r.status === 'rejected') throw r.reason;
            const next = { riders: r.value.items || [], loading: false, refreshing: false, error: null, loadedAt: Date.now() };
            if (c.status === 'fulfilled') {
                next.cash = Object.fromEntries((c.value.items || []).map((x) => [String(x.riderId), x]));
                next.totalOwedPaise = c.value.totalOwedPaise || 0;
            }
            set(next);
        } catch (e) {
            if (mine !== seq) return;
            useOwnerStore.getState().noteError(e);
            set({ loading: false, refreshing: false, error: apiError(e, 'Could not load your riders. Pull down to try again.') });
        }
    },

    reset: () => set({ riders: [], cash: {}, totalOwedPaise: 0, loading: true, refreshing: false, error: null, loadedAt: 0 }),
}));
