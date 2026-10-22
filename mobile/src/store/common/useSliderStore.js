// The sliders waiting to be shown (components/common/AlertSliderHost.jsx): one at a time, the first of the list is on screen.
// item = { key, type, title, body, data, sticky }   sticky = needs an answer, so it never closes by itself and may jump the queue.
import { create } from 'zustand';

export const useSliderStore = create((set) => ({
    queue: [],
    push: (item) => set((s) => {
        if (!item?.key || s.queue.some((q) => q.key === item.key)) return s;
        const head = s.queue[0];
        // one that needs an answer goes in front of a slider that only informs
        if (item.sticky && head && !head.sticky) return { queue: [item, ...s.queue] };
        return { queue: [...s.queue, item] };
    }),
    next: () => set((s) => ({ queue: s.queue.slice(1) })),
    clear: () => set({ queue: [] }),
}));
