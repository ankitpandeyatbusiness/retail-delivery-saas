import { create } from 'zustand';
import { fetchMenu, fetchCollections, fetchFavIds, addFav, removeFav } from '../api/shopApi';
import { readCache, writeCache } from '../utils/cache';

/* ---------------- menu (whole menu + festival / combo strips) ---------------- */
export const useMenuStore = create((set, get) => ({
    categories: [], recommended: [], truncated: false, festival: [], combo: [],
    loaded: false, errorStatus: null,

    async load() {
        if (!get().loaded) {
            const c = await readCache('menu');
            if (c) set({ ...c, loaded: true });
        }
        try {
            const [m, f, c] = await Promise.allSettled([
                fetchMenu(), fetchCollections('festival'), fetchCollections('combo'),
            ]);
            if (m.status !== 'fulfilled') throw m.reason;
            const fresh = {
                categories: m.value.categories || [],
                recommended: m.value.recommended || [],
                truncated: !!m.value.truncated,
                festival: f.value?.items ?? get().festival,
                combo: c.value?.items ?? get().combo,
            };
            set({ ...fresh, loaded: true, errorStatus: null });
            writeCache('menu', fresh);
        } catch (e) {
            set({ loaded: true, errorStatus: e?.response?.status || 'network' });
        }
    },
}));

/* ---------------- cart (shown prices are only a preview; the server quote is the truth) ---------------- */
const sig = (sel) => (sel || []).map((x) => `${x.groupId}:${[...x.optionIds].sort().join('.')}`).sort().join('|');
const save = (lines) => writeCache('cart', { lines });

export const useCartStore = create((set, get) => ({
    lines: [],

    async hydrate() {
        const c = await readCache('cart');
        if (c?.lines && !get().lines.length) set({ lines: c.lines });
    },

    // line: { productId, name, image, isVeg, price, quantity, selections:[{groupId,optionIds}], optionsText, note }
    add(line) {
        const key = `${line.productId}#${sig(line.selections)}#${line.note || ''}`;
        const cur = get().lines;
        const found = cur.find((l) => l.key === key);
        const lines = found
            ? cur.map((l) => (l.key === key ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l))
            : [...cur, { ...line, selections: line.selections || [], key }];
        save(lines);
        set({ lines });
    },

    setQty(key, q) {
        const lines = get().lines
            .map((l) => (l.key === key ? { ...l, quantity: Math.min(20, q) } : l))
            .filter((l) => l.quantity > 0);
        save(lines);
        set({ lines });
    },

    replace(lines) { save(lines); set({ lines }); },
    clear() { save([]); set({ lines: [] }); },
}));

/* ---------------- favourites (ids only, for the hearts) ---------------- */
export const useFavStore = create((set, get) => ({
    ids: [],

    async load() {
        try { set({ ids: (await fetchFavIds()).ids || [] }); } catch (e) { }
    },
    reset() { set({ ids: [] }); },

    async toggle(id) {
        const before = get().ids;
        const has = before.includes(id);
        set({ ids: has ? before.filter((x) => x !== id) : [id, ...before] });
        try {
            if (has) await removeFav(id); else await addFav(id);
            return true;
        } catch (e) {
            set({ ids: before });
            return false;
        }
    },
}));