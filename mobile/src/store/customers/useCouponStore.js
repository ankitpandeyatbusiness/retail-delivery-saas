import { create } from 'zustand';

// Offers page puts a code here, the Cart page picks it up and applies it.
export const useCouponStore = create((set) => ({
    code: '',
    set: (code) => set({ code }),
    clear: () => set({ code: '' }),
}));