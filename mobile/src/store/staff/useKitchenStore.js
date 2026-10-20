// What the kitchen screen shows: the orders to make and the ones that are ready. One load() asks the server; actions change the card at once
// (so the cook sees it move) and the answer from the server replaces it. A failed action puts the card back.
import { create } from 'zustand';
import { fetchKitchenOrders, kitchenStart, kitchenReady } from '../../api/staff/staffApi';
import { playSfx, buzz } from '../../utils/common/sfx';

let seq = 0;   // the newest answer wins when two loads overlap
let known = null;   // ids of the new orders already seen: a new one that was not here before rings the screen

const STAGE_AFTER = { start: 'cooking', ready: 'ready' };

export const useKitchenStore = create((set, get) => ({
    items: [],
    counts: { new: 0, cooking: 0, ready: 0, late: 0 },
    rules: { lateMin: 20, sees: [] },
    state: 'loading',   // loading | ok | error (no connection: the last list stays on screen)
    busy: {},           // orderId -> true while a tap is being sent
    loadedAt: 0,

    load: async () => {
        const mine = ++seq;
        try {
            const r = await fetchKitchenOrders();
            if (mine !== seq) return;
            const fresh = new Set(r.items.filter((o) => o.stage === 'new').map((o) => o.id));
            // a new order after the first load: a chime and a buzz (the loud push covers the phone in a pocket)
            if (known && [...fresh].some((id) => !known.has(id))) { playSfx('orderPlaced'); buzz([0, 250, 120, 250]); }
            known = fresh;
            set({ items: r.items, counts: r.counts, rules: r.rules, state: 'ok', loadedAt: Date.now() });
        } catch (e) {
            if (mine !== seq) return;
            const status = e?.response?.status;
            if (status === 403) { require('./useStaffStore').useStaffStore.getState().load(); return; }   // switched off meanwhile: the app shows why
            set({ state: 'error' });   // the last list stays on screen
        }
    },

    // kind: 'start' | 'ready'. Returns { already, by, ago } when another cook was first, or throws the server's message.
    act: async (id, kind) => {
        if (get().busy[id]) return null;
        const before = get().items;
        set((st) => ({
            busy: { ...st.busy, [id]: true },
            items: st.items.map((o) => (o.id === id ? { ...o, stage: STAGE_AFTER[kind], ...(kind === 'ready' ? { readyAt: new Date().toISOString() } : { startedAt: new Date().toISOString() }) } : o)),
        }));
        try {
            const r = await (kind === 'start' ? kitchenStart(id) : kitchenReady(id));
            set((st) => ({ items: st.items.map((o) => (o.id === id ? r.order : o)) }));
            get().load();   // the counts and the order of the list come from the server
            return r;
        } catch (e) {
            set({ items: before });   // the card goes back where it was
            get().load();
            throw e;
        } finally {
            set((st) => { const b = { ...st.busy }; delete b[id]; return { busy: b }; });
        }
    },

    reset: () => { seq += 1; known = null; set({ items: [], counts: { new: 0, cooking: 0, ready: 0, late: 0 }, state: 'loading', busy: {}, loadedAt: 0 }); },
}));
