import { create } from 'zustand';

// A number that goes up when ANOTHER device of this person changed something. Every screen that loads its data when it comes into view
// (hooks/common/useLiveFocus.js) loads it again when this changes, so the change shows without leaving the screen.
export const useSyncStore = create((set) => ({
    tick: 0,
    bump: () => set((s) => ({ tick: s.tick + 1 })),
}));
