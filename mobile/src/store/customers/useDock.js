// The cards that sit above the tabs (cart, dine in table, reserved table, order on its way) put themselves here while they would be on screen.
// When two or more are there, none of them is drawn: the round dock (components/customers/BottomDock.jsx) is shown instead, with their icons on it.
// entry = { icon, label, sub?, route, params? }. 'track' (the live delivery) and 'order' (an order in progress) are one place, 'track' first.
import { create } from 'zustand';

export const useDock = create((set) => ({
    items: {},
    put: (key, entry) => set((s) => {
        if (!entry && !s.items[key]) return s;
        const items = { ...s.items };
        if (entry) items[key] = entry; else delete items[key];
        return { items };
    }),
}));

const ORDER = ['table', 'track', 'order', 'booking', 'cart'];   // nearest to the round button first: the dine in table matters most
export const dockList = (items) => ORDER.filter((k) => items[k] && !(k === 'order' && items.track)).map((k) => ({ key: k, ...items[k] }));
// true for a card when it should not be drawn because the dock shows it
export const useCrowded = (key) => useDock((s) => !!s.items[key] && dockList(s.items).length >= 2);
