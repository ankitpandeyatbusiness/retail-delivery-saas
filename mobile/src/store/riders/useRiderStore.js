// What the rider's screens share: who he is, the orders offered to him, the deliveries he is carrying, and today's numbers.
// One load() asks for all of it. Home asks again every few seconds while it is open.
import { create } from 'zustand';
import { fetchRiderMe, fetchRiderOrders, fetchSummary, setOnline } from '../../api/riders/riderApi';

let seq = 0;   // the newest answer wins when two loads overlap

export const useRiderStore = create((set, get) => ({
    me: null,
    offers: [],
    active: [],
    summary: null,   // { earnings: { todayPaise, monthPaise }, deliveries: { today, month }, cash: { owedToShopPaise } }
    ready: false,
    error: false,

    load: async () => {
        const mine = ++seq;
        try {
            const [me, offers, active, summary] = await Promise.all([
                fetchRiderMe(), fetchRiderOrders('offered'), fetchRiderOrders('active'), fetchSummary().catch(() => null),
            ]);
            if (mine !== seq) return;
            set({ me, offers: offers.items || [], active: active.items || [], summary, ready: true, error: false });
        } catch (e) {
            if (mine === seq) set((s) => ({ error: !s.ready }));   // a screen that already has data keeps it
        }
    },

    // on duty / off duty. Throws when the server says no (the screen shows why); the switch goes back by itself.
    setDuty: async (isOnline) => {
        const old = get().me;
        set({ me: { ...old, isOnline } });
        try { await setOnline(isOnline); } catch (e) { set({ me: old }); throw e; }
    },

    patchMe: (patch) => set((s) => ({ me: { ...s.me, ...patch } })),
    reset: () => set({ me: null, offers: [], active: [], summary: null, ready: false, error: false }),
}));
