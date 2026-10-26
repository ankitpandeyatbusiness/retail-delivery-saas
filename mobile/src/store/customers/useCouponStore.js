import { create } from 'zustand';

// Offers page puts a code here, the Cart page picks it up and applies it.
export const useCouponStore = create((set) => ({
    code: '',
    until: 0,   // an offer from the shop that runs out (a time in ms): the cart shows the clock
    offer: null,   // the shop's sorry-offer: { code, percent, min }, kept while its clock runs so the cart can show it first, with a timer
    set: (code, until = 0, extra = {}) => set({ code, until, offer: until ? { code, percent: extra.percent || 0, min: extra.min || 0 } : null }),
    clear: () => set({ code: '', until: 0, offer: null }),
}));