import { useEffect, useState } from 'react';

// One clock for every sliding picture on the screen, so they move together and only one timer runs (same as the customer and owner apps).
let tick = 0;
let timer = null;
const subs = new Set();
export function useSlideTick(on) {
    const [t, setT] = useState(tick);
    useEffect(() => {
        if (!on) return undefined;
        subs.add(setT);
        if (!timer) timer = setInterval(() => { tick += 1; subs.forEach((f) => f(tick)); }, 3500);
        return () => { subs.delete(setT); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
    }, [on]);
    return t;
}
// a steady number per dish, so the dishes in a list do not all change picture at the same moment
export const seedOf = (item) => { const k = String(item?._id || item?.name || ''); let h = 0; for (let i = 0; i < k.length; i += 1) h = (h * 31 + k.charCodeAt(i)) % 9973; return h; };
