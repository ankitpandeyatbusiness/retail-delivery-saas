// The Orders board: the list for the chosen chip, its counts, paging, and keeping it fresh.
//
//   filter  one of BOARD_FILTERS ('active', 'placed', ..., 'cancelled')
//   items   orders of that filter, newest first (each carries allowedNext, acceptBy, speech... from the server)
//   counts  how many ACTIVE orders per status, for the chip badges (always for active orders, whatever the filter)
import { create } from 'zustand';
import { fetchOrders, markLooksSeen, apiError } from '../../api/owners/shopApi';
import { serverStatusFor, isFinal, boardStatus } from '../../utils/owners/orderFlow';
import { useOwnerStore } from './useOwnerStore';

const PAGE = 20;
const recent = new Map();   // order id -> { order, at }: orders changed on this phone a moment ago
let seq = 0;   // an old answer must never overwrite a newer one (chip tapped twice, typing in the search box)

export const useOrdersStore = create((set, get) => ({
    filter: 'active',
    query: '',
    items: [],
    counts: {},
    look: { count: 0, urgent: 0, top: null },   // what the server says is still unseen
    hold: null,   // { items } the orders shown under "Needs a look" during THIS visit to the tab. They count as seen the moment the tab opens, but stay listed until he leaves it (like the notification panel)
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
        const startedAt = Date.now();
        const { filter, query } = get();
        if (filter === 'look') { set({ items: get().hold?.items || [], hasMore: false, loading: false, refreshing: false, error: null, loadedAt: Date.now() }); return; }   // already in hand
        if (!quiet) set({ loading: get().items.length === 0, error: null });
        try {
            const params = filter === 'look' ? { look: 'true', page: 1, limit: PAGE } : { status: serverStatusFor(filter), page: 1, limit: PAGE };
            if (/^\d{1,9}$/.test(query.trim())) params.q = query.trim();
            const r = await fetchOrders(params);
            if (mine !== seq) return;
            // an order changed on this phone while this list was on its way: keep the newer version, never the old one
            const fresh = (r.items || []).map((o) => { const p = recent.get(String(o.id)); return p && p.at > startedAt ? p.order : o; });
            set({ items: fresh, counts: r.counts || {}, look: r.look || { count: 0, urgent: 0, top: null }, page: 1, hasMore: !!r.hasMore, loading: false, refreshing: false, loadedAt: Date.now(), error: null });
        } catch (e) {
            if (mine !== seq) return;
            useOwnerStore.getState().noteError(e);
            set({ loading: false, refreshing: false, error: apiError(e, 'Could not load the orders. Pull down to try again.') });
        }
    },
    // The Orders tab is open: read what needs a look, then count all of it as seen at once. The list stays for this visit.
    openLook: async ({ jump = false } = {}) => {
        if (get()._holding) return;
        set({ _holding: true });
        try {
            const r = await fetchOrders({ look: 'true', page: 1, limit: 50 });
            const fresh = r.items || [];
            if (!fresh.length) return;
            const old = get().hold?.items || [];
            const have = new Set(old.map((o) => String(o.id)));
            const items = [...fresh.filter((o) => !have.has(String(o.id))), ...old];
            set({ hold: { items }, look: { count: 0, urgent: 0, top: null } });
            if (get().filter === 'look') set({ items });
            // he came because the tab was blinking: take him straight to "Needs a look" (once per visit, and only from the plain board)
            else if (jump && !get().jumped && get().filter === 'active') { set({ jumped: true }); get().setFilter('look'); }
            await markLooksSeen();
            useOwnerStore.getState().refresh?.();   // the Orders tab and the Home card stop blinking
        } catch (e) { /* tried again the next time the tab is opened */ } finally { set({ _holding: false }); }
    },
    // he left the Orders tab: the chip goes away for good
    closeLook: () => {
        set({ jumped: false });
        if (!get().hold) return;
        set({ hold: null });
        if (get().filter === 'look') get().setFilter('active');
    },

    // the owner opened an order from "Needs a look": it leaves that list at once (the server marks it seen when the order is read)
    markSeenLocal: (id) => {
        const { items, look } = get();
        if (!items.some((o) => String(o.id) === String(id) && o.needsLook && !o.needsLook.seenAt)) return;
        const left = items.filter((o) => String(o.id) !== String(id));
        set({ items: get().filter === 'look' ? left : items.map((o) => (String(o.id) === String(id) ? { ...o, needsLook: { ...o.needsLook, seenAt: new Date().toISOString() } } : o)), look: { ...look, count: Math.max(0, look.count - 1), urgent: Math.max(0, look.urgent - (items.find((o) => String(o.id) === String(id))?.needsLook?.urgent ? 1 : 0)) } });
    },
    refresh: async () => { set({ refreshing: true }); await get().load({ quiet: true }); },

    loadMore: async () => {
        const { hasMore, loadingMore, page, filter, query } = get();
        if (!hasMore || loadingMore || filter === 'look') return;
        const mine = seq;
        set({ loadingMore: true });
        try {
            const params = filter === 'look' ? { look: 'true', page: page + 1, limit: PAGE } : { status: serverStatusFor(filter), page: page + 1, limit: PAGE };
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
        recent.set(String(order.id), { order, at: Date.now() });
        if (recent.size > 40) recent.delete(recent.keys().next().value);
        const { filter } = get();
        // the chip numbers and the tab badge move with the order at once, not after the server's next count
        const was = get().items.find((o) => o.id === order.id) || get().hold?.items.find((o) => o.id === order.id);
        const nowAt = boardStatus(order);
        if (was && boardStatus(was) !== nowAt) {
            const wasAt = boardStatus(was);
            const move = (a) => { const n = { ...(a || {}) }; if (n[wasAt] > 0) n[wasAt] -= 1; if (!isFinal(order.status)) n[nowAt] = (n[nowAt] || 0) + 1; return n; };
            set({ counts: move(get().counts) });
            const live = useOwnerStore.getState().live;
            if (live?.orders?.active) useOwnerStore.setState({ live: { ...live, orders: { ...live.orders, active: move(live.orders.active) } } });
        }
        const stays = filter === 'look' ? !!get().hold?.items.some((o) => String(o.id) === String(order.id))
            : filter === 'active' ? !isFinal(order.status)
            : filter === 'cancelled' ? ['cancelled', 'undelivered'].includes(order.status)
                : nowAt === filter;
        const items = get().items;
        const i = items.findIndex((o) => o.id === order.id);
        if (!stays) { if (i >= 0) set({ items: items.filter((o) => o.id !== order.id) }); return; }
        const hold = get().hold;
        if (hold?.items.some((o) => String(o.id) === String(order.id))) set({ hold: { items: hold.items.map((o) => (String(o.id) === String(order.id) ? { ...o, ...order, needsLook: order.needsLook ?? o.needsLook } : o)) } });
        if (i >= 0) set({ items: items.map((o) => (o.id === order.id ? (filter === 'look' ? { ...o, ...order, needsLook: order.needsLook ?? o.needsLook } : order) : o)) });
        else set({ items: [order, ...items] });
    },
}));
