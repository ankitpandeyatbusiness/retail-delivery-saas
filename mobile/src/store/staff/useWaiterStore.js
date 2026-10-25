// What the waiter's screen shows: dishes ready to serve, what the tables ask for, and the tables. One load() asks the server. "Served" and "Done"
// take the card off the list at once; the answer from the server (or a failure, which puts the card back) follows.
import { create } from 'zustand';
import { fetchWaiterOverview, waiterServe, waiterDoneRequest, waiterUndo } from '../../api/staff/staffApi';
import { staffAlert } from '../../utils/staff/staffSound';
import { readCache, writeCache } from '../../utils/common/cache';
import { useAuthStore } from '../common/useAuthStore';

const KEY = () => 'waiterList:' + (useAuthStore.getState().user?.id || '');

let seq = 0;   // the newest answer wins when two loads overlap
let known = null;   // ids of the dishes and requests already seen: a new one rings the screen

const EMPTY = { serve: [], served: [], requests: [], tables: [], counts: { serve: 0, late: 0, requests: 0, bills: 0 }, rules: { serveLateMin: 5, canSettle: true, tables: 0 } };

export const useWaiterStore = create((set, get) => ({
    ...EMPTY,
    state: 'loading',   // loading | ok | error (no connection: the last list stays on screen)
    busy: {},           // id -> true while a tap is being sent
    loadedAt: 0,

    load: async () => {
        const mine = ++seq;
        try {
            const r = await fetchWaiterOverview();
            if (mine !== seq) return;
            const ids = new Set([...r.serve.map((o) => `s${o.id}`), ...r.requests.map((q) => `r${q.id}`)]);
            // a dish that became ready, or a table that asked for something, after the first load: a sound and a buzz (the push covers a pocket)
            if (known) {
                r.serve.filter((o) => !known.has(`s${o.id}`)).forEach((o) => staffAlert({ kind: 'ready', table: o.table, orderNo: o.orderNo }));
                r.requests.filter((q) => !known.has(`r${q.id}`)).forEach((q) => staffAlert({ kind: q.type === 'bill' ? 'bill' : 'call', table: q.table }));
            }
            known = ids;
            set({ serve: r.serve, served: r.served || [], requests: r.requests, tables: r.tables, counts: r.counts, rules: r.rules, state: 'ok', loadedAt: Date.now() });
            writeCache(KEY(), { serve: r.serve, served: r.served || [], requests: r.requests, tables: r.tables, counts: r.counts, rules: r.rules });
        } catch (e) {
            if (mine !== seq) return;
            if (e?.response?.status === 403) { require('./useStaffStore').useStaffStore.getState().load(); return; }   // switched off meanwhile: the app shows why
            set({ state: 'error' });   // the last list stays on screen
        }
    },

    // the screen shows at once with what was on it last time; the server's answer replaces it a moment later
    hydrate: async () => {
        const c = await readCache(KEY());
        if (c?.serve && get().state === 'loading') set({ ...c, state: 'ok' });
    },

    // kind: 'serve' | 'done'. Returns the server's answer ({ already }) or throws its message.
    act: async (kind, id) => {
        const key = `${kind}${id}`;
        if (get().busy[key]) return null;
        const before = { serve: get().serve, requests: get().requests, counts: get().counts };
        set((st) => ({
            busy: { ...st.busy, [key]: true },
            ...(kind === 'serve'
                ? { serve: st.serve.filter((o) => o.id !== id), counts: { ...st.counts, serve: Math.max(0, st.counts.serve - 1) } }
                : { requests: st.requests.filter((q) => q.id !== id), counts: { ...st.counts, requests: Math.max(0, st.counts.requests - 1) } }),
        }));
        try {
            const r = await (kind === 'serve' ? waiterServe(id) : waiterDoneRequest(id));
            get().load();   // the counts and the tables come from the server
            return r;
        } catch (e) {
            set(before);   // the card goes back where it was
            get().load();
            throw e;
        } finally {
            set((st) => { const b = { ...st.busy }; delete b[key]; return { busy: b }; });
        }
    },

    // takes a mistaken Served back; the server decides if it is still allowed
    undo: async (id) => {
        const key = `undo${id}`;
        if (get().busy[key]) return;
        set((st) => ({ busy: { ...st.busy, [key]: true } }));
        try { await waiterUndo(id); } finally {
            set((st) => { const b = { ...st.busy }; delete b[key]; return { busy: b }; });
            get().load();
        }
    },

    reset: () => { seq += 1; known = null; set({ ...EMPTY, state: 'loading', busy: {}, loadedAt: 0 }); },
}));
