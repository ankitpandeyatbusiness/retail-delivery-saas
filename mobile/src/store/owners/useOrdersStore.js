// The Orders board: the list for the chosen chip, its counts, paging, and keeping it fresh.
//
//   filter  one of BOARD_FILTERS ('active', 'placed', ..., 'cancelled')
//   items   orders of that filter, newest first (each carries allowedNext, acceptBy, speech... from the server)
//   counts  how many ACTIVE orders per status, for the chip badges (always for active orders, whatever the filter)
import { create } from 'zustand';
import { fetchOrders, apiError } from '../../api/owners/shopApi';
import { serverStatusFor, isFinal } from '../../utils/owners/orderFlow';
import { useOwnerStore } from './useOwnerStore';

const PAGE = 20;
let seq = 0;   // an old answer must never overwrite a newer one (chip tapped twice, typing in the search box)

export const useOrdersStore = create((set, get) => ({
    filter: 'active',
    query: '',
    items: [],
    counts: {},
    page: 1,
    hasMore: false,
    loading: true,       // first load of a list: show skeletons
    refreshing: false,   // pull to refresh
    loadingMore: false,
    error: null,
    loadedAt: 0,

    setFilter: (filter) => {
        if (filter === get().filter) return;
        set({ filter, items: [], hasMore: false, page: 1, loading: true, error: null });
        get().load();
    },
    setQuery: (query) => { set({ query }); get().load({ quiet: true }); },

    // the first page of the current filter
    load: async ({ quiet = false } = {}) => {
        const mine = ++seq;
        const { filter, query } = get();
        if (!quiet) set({ loading: get().items.length === 0, error: null });
        try {
            const params = { status: serverStatusFor(filter), page: 1, limit: PAGE };
            if (/^\d{1,9}$/.test(query.trim())) params.q = query.trim();
            const r = await fetchOrders(params);
            if (mine !== seq) return;
            set({ items: r.items || [], counts: r.counts || {}, page: 1, hasMore: !!r.hasMore, loading: false, refreshing: false, loadedAt: Date.now(), error: null });
        } catch (e) {
            if (mine !== seq) return;
            useOwnerStore.getState().noteError(e);
            set({ loading: false, refreshing: false, error: apiError(e, 'Could not load the orders. Pull down to try again.') });
        }
    },
    refresh: async () => { set({ refreshing: true }); await get().load({ quiet: true }); },

    loadMore: async () => {
        const { hasMore, loadingMore, page, filter, query } = get();
        if (!hasMore || loadingMore) return;
        const mine = seq;
        set({ loadingMore: true });
        try {
            const params = { status: serverStatusFor(filter), page: page + 1, limit: PAGE };
            if (/^\d{1,9}$/.test(query.trim())) params.q = query.trim();
            const r = await fetchOrders(params);
            if (mine !== seq) return;
            const have = new Set(get().items.map((o) => o.id));
            set({ items: [...get().items, ...(r.items || []).filter((o) => !have.has(o.id))], page: page + 1, hasMore: !!r.hasMore, loadingMore: false });
        } catch (e) { set({ loadingMore: false }); }
    },

    // an order changed (accepted, cancelled...): show the new version at once, or drop it from a list it no longer belongs to
    patch: (order) => {
        if (!order?.id) return;
        const { filter } = get();
        const stays = filter === 'active' ? !isFinal(order.status)
            : filter === 'cancelled' ? ['cancelled', 'undelivered'].includes(order.status)
                : order.status === filter;
        const items = get().items;
        const i = items.findIndex((o) => o.id === order.id);
        if (!stays) { if (i >= 0) set({ items: items.filter((o) => o.id !== order.id) }); return; }
        if (i >= 0) set({ items: items.map((o) => (o.id === order.id ? order : o)) });
        else set({ items: [order, ...items] });
    },
}));
