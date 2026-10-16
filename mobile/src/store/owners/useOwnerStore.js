// What the owner's screens share: the live picture of the shop, and what the owner is allowed to do right now.
//
//   access: 'ok'      everything works
//           'paused'  rent is unpaid: orders, riders, cash, money and rent stay open; menu and settings are closed
//           'blocked' the platform switched this panel off: only orders in progress, rent and notifications stay open
import { create } from 'zustand';
import { fetchLive, fetchBillingStatus, accessState } from '../../api/owners/shopApi';

export const useOwnerStore = create((set, get) => ({
    live: null,          // GET /shop/live
    billing: null,       // GET /shop/billing/status
    access: 'ok',
    loadedAt: 0,
    error: null,

    // Any owner screen that gets a 403 { paused } / { blocked } tells the store, so every screen shows the same banner.
    noteError: (e) => {
        const a = accessState(e);
        if (a && get().access !== a) set({ access: a });
        return a;
    },

    refresh: async () => {
        try {
            const [live, billing] = await Promise.allSettled([fetchLive(), fetchBillingStatus()]);
            const next = { loadedAt: Date.now(), error: null };
            if (live.status === 'fulfilled') next.live = live.value;
            if (billing.status === 'fulfilled') {
                next.billing = billing.value;
                if (get().access !== 'blocked') next.access = billing.value.paused ? 'paused' : 'ok';
            }
            // /live is open while rent is unpaid, so a "blocked" answer there means the panel itself is switched off
            if (live.status === 'rejected') {
                const a = accessState(live.reason);
                if (a === 'blocked') next.access = 'blocked';
                else next.error = 'Could not load the shop. Pull down to try again.';
            }
            set(next);
        } catch (e) {
            set({ error: 'Could not load the shop. Pull down to try again.' });
        }
    },

    reset: () => set({ live: null, billing: null, access: 'ok', loadedAt: 0, error: null }),
}));
