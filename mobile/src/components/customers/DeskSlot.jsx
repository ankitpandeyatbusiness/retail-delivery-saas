// The floating cards of the DESKTOP website (the dine-in table, the order on its way, the live delivery, the reserved table) are all drawn in the bottom-left
// corner. Each one used to sit at the same spot, so they covered each other. Now they form ONE stack: each card tells here how tall it is, and the cards above
// it rise by that much plus a gap. The cart card has the bottom-right corner to itself.
//   bottom -> top: dine-in table | live delivery | order in progress | reserved table   (at most one of the first three is shown at a time)
import { useEffect } from 'react';
import { create } from 'zustand';

export const useDeskStack = create((set) => ({
    h: {},
    put: (k, v) => set((s) => (s.h[k] === v ? s : { h: { ...s.h, [k]: v } })),
}));

const ORDER = ['table', 'track', 'order', 'booking'];
const EDGE = 24;   // the gap to the window's edge
const GAP = 12;    // the gap between two cards

// how far above the bottom edge the card `key` sits: the edge gap plus the cards below it
export function useDeskBottom(key) {
    const h = useDeskStack((s) => s.h);
    let b = EDGE;
    for (const k of ORDER) {
        if (k === key) break;
        if (h[k] > 0) b += h[k] + GAP;
    }
    return b;
}

// drawn inside a card while it is on screen: tells the stack its height, and gives the room back when the card goes
export function DeskSlotReport({ k, h }) {
    useEffect(() => { useDeskStack.getState().put(k, h || 0); }, [k, h]);
    useEffect(() => () => useDeskStack.getState().put(k, 0), [k]);
    return null;
}
