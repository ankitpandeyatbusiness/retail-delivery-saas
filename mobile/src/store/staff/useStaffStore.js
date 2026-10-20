// What the kitchen and waiter screens share: who the person is, and whether the shop still lets them in.
// state: 'loading' (first load) | 'ok' | 'blocked' (paused, panel switched off, not staff: `block` says why) | 'error' (no network)
import { create } from 'zustand';
import { fetchStaffMe } from '../../api/staff/staffApi';

let seq = 0;   // the newest answer wins when two loads overlap

export const useStaffStore = create((set, get) => ({
    me: null,
    state: 'loading',
    block: null,   // { code, message }

    load: async () => {
        const mine = ++seq;
        try {
            const me = await fetchStaffMe();
            if (mine === seq) set({ me, state: 'ok', block: null });
        } catch (e) {
            if (mine !== seq) return;
            const r = e?.response;
            if (r?.status === 403 && r.data?.code) set({ state: 'blocked', block: { code: r.data.code, message: r.data.error || '' } });
            else set((st) => ({ state: st.me ? st.state : 'error' }));   // a screen that already has data keeps it
        }
    },

    patchMe: (patch) => set((s) => ({ me: { ...s.me, ...patch } })),
    reset: () => { seq += 1; set({ me: null, state: 'loading', block: null }); },
}));
