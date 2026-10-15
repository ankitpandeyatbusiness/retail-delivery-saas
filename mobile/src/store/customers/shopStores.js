import { create } from 'zustand';
import { fetchMenu, fetchCollections, fetchFavIds, addFav, removeFav } from '../../api/customers/shopApi';
import { readCache, writeCache } from '../../utils/common/cache';

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

// the screens plug their toast in here (the store file must not import UI code)
export const cartHooks = { onCap: null };

export const useCartStore = create((set, get) => ({
    lines: [],

    async hydrate() {
        const c = await readCache('cart');
        if (c?.lines && !get().lines.length) set({ lines: c.lines });
    },

    // line: { productId, name, image, isVeg, price, quantity, selections:[{groupId,optionIds}], optionsText, note }
    // The item may carry maxQty (the most the shop can give right now: pieces, or g / ml). The cart never asks for
    // more than that, and tells the customer in words, never with the real number. The server checks again.
    add(line) {
        const key = `${line.productId}#${sig(line.selections)}#${line.note || ''}#${line.measureQty || ''}`;
        const cur = get().lines;
        const found = cur.find((l) => l.key === key);
        const max = line.maxQty;
        const others = cur.filter((l) => l.key !== key && String(l.productId) === String(line.productId));
        let quantity = found ? (line.measureQty ? 1 : Math.min(20, found.quantity + line.quantity)) : line.quantity;
        if (max != null) {
            if (line.measureQty) {
                const used = others.reduce((a, l) => a + (l.measureQty || 0) * l.quantity, 0);
                if (used + line.measureQty > max) { cartHooks.onCap?.('That is more than we have right now. Try a smaller amount.'); return; }
            } else {
                const room = max - others.reduce((a, l) => a + l.quantity, 0);
                if (quantity > room) {
                    quantity = Math.max(0, room);
                    cartHooks.onCap?.('Only a few left. You cannot add more.');
                    if (quantity <= 0) return;
                }
            }
        }
        const lines = found
            ? cur.map((l) => (l.key === key ? { ...l, quantity, maxQty: max ?? l.maxQty } : l))
            : [...cur, { ...line, quantity, selections: line.selections || [], key }];
        save(lines);
        set({ lines });
    },

    setQty(key, q) {
        const cur = get().lines;
        const line = cur.find((l) => l.key === key);
        let want = Math.min(20, q);
        if (line && line.maxQty != null && !line.measureQty && want > line.quantity) {
            const room = line.maxQty - cur.filter((l) => l.key !== key && String(l.productId) === String(line.productId)).reduce((a, l) => a + l.quantity, 0);
            if (want > room) {
                want = Math.max(line.quantity, room);   // never below what is already in the cart
                cartHooks.onCap?.('Only a few left. You cannot add more.');
            }
        }
        const lines = cur
            .map((l) => (l.key === key ? { ...l, quantity: want } : l))
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