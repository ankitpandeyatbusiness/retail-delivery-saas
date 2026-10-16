// Is the owner's side menu open? (components/owners/OwnerDrawer.jsx)
import { create } from 'zustand';

export const useDrawer = create((set) => ({ open: false, show: () => set({ open: true }), hide: () => set({ open: false }) }));
