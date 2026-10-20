// The customer's table bill while he is dining in: all his rounds, what is owed, and whether he has asked for the bill.
import { create } from 'zustand';
import { fetchTableBill, askTableBill } from '../../api/customers/shopApi';

export const useTableBill = create((set, get) => ({
    bill: null,        // { open, table, status, rounds, total, due, ... } or { open: false }
    loading: false,
    load: async () => {
        try { set({ bill: await fetchTableBill() }); } catch (e) { /* the last bill stays on screen */ }
    },
    ask: async () => {
        set({ loading: true });
        try { set({ bill: await askTableBill() }); } finally { set({ loading: false }); }
    },
    reset: () => set({ bill: null }),
}));
