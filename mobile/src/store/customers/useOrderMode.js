// How the customer is ordering right now: delivery, pickup, or dine in at a table. It is chosen on the Home screen (and a table QR sets it),
// kept on the phone, and the cart follows it.
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'order.mode.v1';
const save = (s) => AsyncStorage.setItem(KEY, JSON.stringify({ mode: s.mode, table: s.table })).catch(() => { });

export const useOrderMode = create((set, get) => ({
    mode: 'delivery',   // delivery | pickup | dine_in
    table: '',          // the table number while dining in
    ready: false,
    load: async () => {
        if (get().ready) return;
        try {
            const j = JSON.parse((await AsyncStorage.getItem(KEY)) || '{}');
            set({ mode: j.mode || 'delivery', table: j.table || '', ready: true });
        } catch (e) { set({ ready: true }); }
    },
    setMode: (mode) => { set({ mode }); save(get()); },
    // choosing a table also means he is dining in
    setTable: (table) => { set({ table: String(table || ''), mode: table ? 'dine_in' : get().mode }); save(get()); },
}));

// the ways this shop can be ordered from, in the order they are shown
export const modesOf = (full) => {
    const types = full?.orders?.types || [];
    const out = [];
    if (types.includes('delivery') || !types.length) out.push('delivery');
    if (types.includes('pickup')) out.push('pickup');
    if (full?.orders?.dineIn?.enabled) out.push('dine_in');
    return out;
};
