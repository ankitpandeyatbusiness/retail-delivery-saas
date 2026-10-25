import { create } from 'zustand';

// Offers page puts a code here, the Cart page picks it up and applies it.
export const useCouponStore = create((set) => ({
    code: '',
    until: 0,   // an offer from the shop that runs out (a time in ms): the cart shows the clock
    set: (code, until = 0) => set({ code, until }),
    clear: () => set({ code: '', until: 0 }),
}));