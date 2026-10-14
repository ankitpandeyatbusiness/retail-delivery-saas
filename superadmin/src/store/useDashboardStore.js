import { create } from 'zustand';
import { fetchShops } from '../api/shopsApi';
import { fetchSales, fetchInbox, fetchInvoices } from '../api/dashboardApi';
import { errMsg } from '../api/adminClient';

const todayIst = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

// Each tile loads on its own: one failing call never blanks the whole dashboard.
export const useDashboardStore = create((set) => ({
    shops: null,        // { total, taking, attention, suspended }
    today: null,        // { orders, revenue, topShops }
    unreadAlerts: null,
    overdueInvoices: null,
    attention: [],      // shops that are not taking orders (first few)
    loading: false,
    refreshing: false,
    error: null,

    async load({ refresh = false } = {}) {
        set(refresh ? { refreshing: true } : { loading: true });
        const day = todayIst();
        const [shops, sales, inbox, inv] = await Promise.allSettled([
            fetchShops(),
            fetchSales({ from: day, to: day }),
            fetchInbox({ unread: 'true', limit: 1 }),
            fetchInvoices({ status: 'overdue', limit: 50 }),
        ]);

        const patch = { loading: false, refreshing: false, error: null };
        if (shops.status === 'fulfilled') {
            const items = shops.value.items || [];
            const bad = items.filter((s) => !s.state?.acceptingOrders);
            patch.shops = {
                total: items.length,
                taking: items.length - bad.length,
                attention: bad.filter((s) => s.status === 'active').length,
                suspended: items.filter((s) => s.status !== 'active').length,
            };
            patch.attention = bad.slice(0, 5);
        } else patch.error = errMsg(shops.reason);

        if (sales.status === 'fulfilled') {
            const r = sales.value;
            patch.today = { orders: r.totals?.orders || 0, revenue: r.totals?.revenue || 0, topShops: (r.shops || []).slice(0, 3) };
        }
        if (inbox.status === 'fulfilled') patch.unreadAlerts = inbox.value.unreadCount ?? 0;
        if (inv.status === 'fulfilled') patch.overdueInvoices = (inv.value.items || []).length + (inv.value.hasMore ? '+' : '');
        set(patch);
    },
}));
