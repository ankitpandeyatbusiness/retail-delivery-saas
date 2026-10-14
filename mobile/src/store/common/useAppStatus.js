import { create } from 'zustand';

// frozen: set by the API client on 402 (shop suspended) or 503 (maintenance)
// offline: set when a request fails with no server answer
export const useAppStatus = create((set) => ({
    frozen: null, // { status, message, maintenance, until }
    offline: false,
    setFrozen: (frozen) => set({ frozen }),
    clearFrozen: () => set({ frozen: null }),
    setOffline: (v) => set((st) => (st.offline === v ? st : { offline: v })),
}));