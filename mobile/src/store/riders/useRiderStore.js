// What the rider's screens share: who he is, the orders offered to him, the deliveries he is carrying, and today's numbers.
// One load() asks for all of it. Home asks again every few seconds while it is open.
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchRiderMe, fetchRiderOrders, fetchSummary, setOnline } from '../../api/riders/riderApi';

let seq = 0;   // the newest answer wins when two loads overlap
const SEEN_KEY = 'rider_missed_seen_at';   // when he last opened History (offers missed after that make the red dot)
let seenAt = null;
const readSeen = async () => {
    if (seenAt) return seenAt;
    try { seenAt = await AsyncStorage.getItem(SEEN_KEY); } catch (e) { /* the dot just starts from now */ }
    if (!seenAt) { seenAt = new Date().toISOString(); AsyncStorage.setItem(SEEN_KEY, seenAt).catch(() => { }); }
    return seenAt;
};

export const useRiderStore = create((set, get) => ({
    me: null,
    offers: [],
    active: [],
    summary: null,   // { earnings: { todayPaise, monthPaise }, deliveries: { today, month }, cash: { owedToShopPaise } }
    ready: false,
    error: false,
    missedNew: 0,   // offers that ran out since he last opened History

    load: async () => {
        const mine = ++seq;
        try {
            const since = await readSeen();
            const [me, offers, active, summary] = await Promise.all([
                fetchRiderMe(), fetchRiderOrders('offered', 1, since), fetchRiderOrders('active'), fetchSummary().catch(() => null),
            ]);
            if (mine !== seq) return;
            set({ me, offers: offers.items || [], active: active.items || [], summary, ready: true, error: false, missedNew: offers.counts?.missed || 0 });
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

    // he opened History: the red dot goes until the next offer is missed
    markMissedSeen: () => {
        seenAt = new Date().toISOString();
        AsyncStorage.setItem(SEEN_KEY, seenAt).catch(() => { });
        set({ missedNew: 0 });
    },

    patchMe: (patch) => set((s) => ({ me: { ...s.me, ...patch } })),
    reset: () => { seenAt = null; set({ me: null, offers: [], active: [], summary: null, ready: false, error: false, missedNew: 0 }); },
}));
