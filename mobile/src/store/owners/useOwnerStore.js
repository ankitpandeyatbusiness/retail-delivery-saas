// What the owner's screens share: the live picture of the shop, the Home dashboard, and what the owner is allowed to do
// right now.
//
//   access: 'ok'      everything works
//           'paused'  rent is unpaid: orders, riders, cash, money and rent stay open; menu and settings are closed
//           'blocked' the platform switched this panel off: only orders in progress, rent and notifications stay open
import { create } from 'zustand';
import { fetchLive, fetchBillingStatus, fetchDashboard, fetchShopNotifications, fetchSupport, accessState } from '../../api/owners/shopApi';

let seq = 0;   // the newest answer wins when two refreshes overlap

export const useOwnerStore = create((set, get) => ({
    live: null,          // GET /shop/live: order counts by status, riders, feed lines
    dashboard: null,     // GET /shop/dashboard: today vs yesterday, by hour, waiting orders, stock, riders, complaints, SMS, rent
    billing: null,       // GET /shop/billing/status
    access: 'ok',
    unread: 0,           // unread messages in the owner's inbox (the bell)
    supportUnread: 0,    // help requests with a reply he has not read
    loadedAt: 0,
    error: null,

    // Any owner screen that gets a 403 { paused } / { blocked } tells the store, so every screen shows the same banner.
    noteError: (e) => {
        const a = accessState(e);
        if (a && get().access !== a) set({ access: a });
        return a;
    },

    refresh: async () => {
        const mine = ++seq;
        try {
            const [live, billing, dashboard, inbox, help] = await Promise.allSettled([fetchLive(), fetchBillingStatus(), fetchDashboard(), fetchShopNotifications({ unread: true, limit: 1 }), fetchSupport({ status: 'open' })]);
            if (mine !== seq) return;
            const next = { loadedAt: Date.now(), error: null };
            if (live.status === 'fulfilled') next.live = live.value;
            if (dashboard.status === 'fulfilled') next.dashboard = dashboard.value;
            if (inbox.status === 'fulfilled') next.unread = inbox.value.unreadCount || 0;
            if (help.status === 'fulfilled') next.supportUnread = help.value.unreadCount || 0;
            if (billing.status === 'fulfilled') {
                next.billing = billing.value;
                if (get().access !== 'blocked') next.access = billing.value.paused ? 'paused' : 'ok';
            }
            // /live and /dashboard are open while rent is unpaid, so a "blocked" answer there means the panel itself is switched off
            const failed = [live, dashboard].find((r) => r.status === 'rejected');
            if (failed) {
                const a = accessState(failed.reason);
                if (a === 'blocked') next.access = 'blocked';
                else if (!get().live && !get().dashboard) next.error = 'Could not load the shop. Pull down to try again.';
            }
            set(next);
        } catch (e) {
            if (mine === seq) set({ error: 'Could not load the shop. Pull down to try again.' });
        }
    },

    reset: () => set({ unread: 0, supportUnread: 0, live: null, dashboard: null, billing: null, access: 'ok', loadedAt: 0, error: null }),
}));
