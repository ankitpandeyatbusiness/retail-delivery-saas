import { create } from 'zustand';

// frozen: set by the API client on 402 (shop suspended) or 503 (maintenance)
// offline: set when a request fails with no server answer
export const useAppStatus = create((set) => ({
    frozen: null, // { status, message, maintenance, until }
    offline: false,
    maintenance: null, // { phase: 'on'|'upcoming', message, until, startAt, draining } (shown as the bar on every screen, see MaintenanceBar)
    setMaintenance: (m) => set((st) => (JSON.stringify(st.maintenance) === JSON.stringify(m) ? st : { maintenance: m })),
    setFrozen: (frozen) => set({ frozen }),
    clearFrozen: () => set({ frozen: null }),
    setOffline: (v) => set((st) => (st.offline === v ? st : { offline: v })),
}));