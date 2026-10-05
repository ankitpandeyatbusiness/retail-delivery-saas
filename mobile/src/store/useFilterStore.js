import { create } from 'zustand';

export const useFilterStore = create((set) => ({
    category: null,
    active: [],
    sort: null,

    setCategory: (id) => set((s) => ({ category: s.category === id ? null : id })),
    toggleFilter: (id) =>
        set((s) => ({
            active: s.active.includes(id) ? s.active.filter((x) => x !== id) : [...s.active, id],
        })),
    setSort: (sort) => set({ sort }),
}));