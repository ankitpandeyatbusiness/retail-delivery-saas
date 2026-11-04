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
    { value: 'rent', label: 'Rent due' },
    { value: 'quiet', label: 'No orders 14 days' },
    { value: 'attention', label: 'Needs attention' },
    { value: 'free', label: 'Free period' },
    { value: 'suspended', label: 'Closed' },   // (the value stays "suspended": the Home screen opens this list with it)
];

export const matchesFilter = (shop, f) => {
    if (f === 'open') return !!shop.state?.acceptingOrders;
    if (f === 'rent') return shop.status === 'active' && (shop.stats?.owed || 0) > 0;
    if (f === 'quiet') return !!shop.stats?.quiet;
    if (f === 'attention') return !shop.state?.acceptingOrders && shop.status === 'active';
    if (f === 'free') return shop.status === 'active' && shop.rent?.stage === 'free';
    if (f === 'suspended') return shop.status !== 'active';
    return true;
};

export const SORTS = [
    { value: 'attention', label: 'Needs attention first', hint: 'Problems on top, closed shops last' },
    { value: 'orders', label: 'Most orders today', hint: 'The busiest shops first' },
    { value: 'rent', label: 'Most rent due', hint: 'Who owes the most first' },
    { value: 'quiet', label: 'Quietest first', hint: 'Longest without an order first' },
    { value: 'newest', label: 'Newest', hint: 'Added most recently first' },
    { value: 'name', label: 'A to Z', hint: 'By shop name' },
];

// how urgent a shop is: closed last; then not taking orders, rent overdue, quiet; then the busiest
const urgency = (s) => {
    if (s.status !== 'active') return -1000;
    let u = 0;
    if (!s.state?.acceptingOrders) u += 100;
    if ((s.stats?.overdue || 0) > 0) u += 50;
    if (s.stats?.quiet) u += 20;
    return u;
};
export const sortShops = (list, by) => {
    const a = [...list];
    const num = (x) => Number(x || 0);
    if (by === 'orders') return a.sort((x, y) => num(y.stats?.ordersToday) - num(x.stats?.ordersToday) || x.name.localeCompare(y.name));
    if (by === 'rent') return a.sort((x, y) => num(y.stats?.owed) - num(x.stats?.owed) || x.name.localeCompare(y.name));
    if (by === 'quiet') return a.sort((x, y) => (x.stats?.lastOrderAt ? new Date(x.stats.lastOrderAt).getTime() : 0) - (y.stats?.lastOrderAt ? new Date(y.stats.lastOrderAt).getTime() : 0));
    if (by === 'newest') return a.sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
    if (by === 'name') return a.sort((x, y) => x.name.localeCompare(y.name));
    return a.sort((x, y) => urgency(y) - urgency(x) || num(y.stats?.ordersToday) - num(x.stats?.ordersToday) || x.name.localeCompare(y.name));
};
