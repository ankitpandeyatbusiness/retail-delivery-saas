import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAddresses } from '../api/shopApi';

const fallback = (items) => items.find((i) => i.isDefault) || items[0] || null;

export const useAddressStore = create(persist((set, get) => ({
    selected: null,
    setSelected: (a) => set({ selected: a }),
    clear: () => set({ selected: null }),
    // keep the selection valid after add / edit / delete
    sync: (items) => {
        const cur = get().selected;
        const fresh = cur && items.find((i) => i._id === cur._id);
        set({ selected: fresh || fallback(items) });
    },
    refresh: async () => {
        try { get().sync((await fetchAddresses()).items || []); } catch (e) { /* keep current */ }
    },
}), {
    name: 'delivery-address',
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (s) => ({ selected: s.selected }),
}));