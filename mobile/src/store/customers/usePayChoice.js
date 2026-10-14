import { create } from 'zustand';

// The payment method picked for the cart. The payment screens write it and simply go BACK, instead of
// navigating to a new Cart screen with params (which stacked a second Cart on top of the first).
// `card` is held in memory for ONE payment attempt only and is never saved anywhere.
export const usePayChoice = create((set) => ({
    label: 'Cash on Delivery',
    value: 'cod',          // cod | upi | card
    upiApp: null,          // { pkg, label }
    card: null,            // { number, month, year, cvv, name }
    choose: (c) => set({ label: c.label, value: c.value, upiApp: c.upiApp || null, card: c.card || null }),
    clearCard: () => set({ card: null }),
    reset: () => set({ label: 'Cash on Delivery', value: 'cod', upiApp: null, card: null }),
}));
