// Alerts that wait for a tap (a cancelled order): they show as a popup over whatever the cook or the waiter is doing, one after the other.
import { create } from 'zustand';

export const useStaffAlertStore = create((set) => ({
    items: [],   // { id, kind, orderNo, table }
    push: (a) => set((st) => (st.items.some((x) => x.id === a.id) ? st : { items: [...st.items, a].slice(-6) })),
    dismiss: (id) => set((st) => ({ items: st.items.filter((x) => x.id !== id) })),
    clear: () => set({ items: [] }),
}));
