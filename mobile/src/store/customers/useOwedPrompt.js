// Opens the customer's unpaid-bill popup from anywhere (the cart, a notification, the Orders and Account screens).
import { create } from 'zustand';

export const useOwedPrompt = create((set) => ({ open: false, show: () => set({ open: true }), hide: () => set({ open: false }) }));
