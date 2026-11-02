// The BULK ORDER cart: the dishes the customer picked for a bulk order, and the details he filled in (pickup or delivery, day and time, address,
// instructions, contact). It is kept on the phone, so he can go to Home and come back. A bulk order and a normal order never share a cart:
// adding a normal dish while a bulk cart exists asks first, and starting a bulk cart while a normal cart exists asks first (the other cart is emptied).
import { create } from 'zustand';
import { readCache, writeCache } from '../../utils/common/cache';
import { ask } from '../../components/common/dialog';
import { useCartStore, cartHooks } from './shopStores';
import { tr } from '../../i18n';

const KEY = 'bulkCart';
const FRESH_FORM = {
    fulfilment: 'pickup', day: '', time: '', address: null,
    cutlery: false, packaging: 'any', note: '',
    foodTags: [], foodNote: '', delTags: [], delNote: '',
    contact: { name: '', phone: '', onSitePhone: '', company: '', gstin: '' },
};
const save = (s) => writeCache(KEY, { lines: s.lines, form: s.form });
const keyOf = (productId, selections) => `${productId}|${JSON.stringify((selections || []).map((x) => [x.groupId, [...x.optionIds].sort()]).sort())}`;

export const useBulkCartStore = create((set, get) => ({
    lines: [],   // { key, productId, name, image, isVeg, selections, label, quantity, minQty, at }
    form: FRESH_FORM,
    ready: false,

    async hydrate() {
        if (get().ready) return;
        const c = await readCache(KEY);
        set({ ready: true, ...(c?.lines?.length || c?.form ? { lines: c.lines || [], form: { ...FRESH_FORM, ...(c.form || {}), contact: { ...FRESH_FORM.contact, ...(c.form?.contact || {}) } } } : {}) });
    },

    qtyOf: (productId, selections) => get().lines.find((l) => l.key === keyOf(productId, selections))?.quantity || 0,

    // one line of the bulk cart: item = the menu dish { id, name, image, isVeg }, n = how many (0 removes it), minQty = the least he may order of this one
    setQty(item, selections, label, n, minQty = 0) {
        const key = keyOf(item.id, selections);
        const rest = get().lines.filter((l) => l.key !== key);
        const old = get().lines.find((l) => l.key === key);
        const lines = n > 0
            ? [...rest, { key, productId: item.id, name: item.name, image: item.image || null, isVeg: item.isVeg, selections: selections || [], label, quantity: n, minQty, at: old?.at || Date.now() }].sort((a, b) => a.at - b.at)
            : rest;
        set({ lines });
        save({ lines, form: get().form });
    },
    setForm(patch) {
        const form = { ...get().form, ...patch };
        set({ form });
        save({ lines: get().lines, form });
    },
    setContact(patch) { get().setForm({ contact: { ...get().form.contact, ...patch } }); },
    // after the request was sent (or the customer emptied it)
    clear() {
        const form = { ...FRESH_FORM, contact: get().form.contact };   // his name and phone stay for next time
        set({ lines: [], form });
        save({ lines: [], form });
    },
    count: () => get().lines.length,
    pieces: () => get().lines.reduce((a, l) => a + l.quantity, 0),
}));

export const keyOfBulk = keyOf;
useBulkCartStore.getState().hydrate();

// A normal dish is being added: if a bulk cart is waiting, ask first. Yes = the bulk cart is emptied and the dish is added; No = nothing changes.
cartHooks.beforeAdd = (line) => {
    if (!useBulkCartStore.getState().lines.length) return true;
    ask({
        title: tr('Remove your bulk order?'),
        message: tr('You have a bulk order in progress. Adding this dish will remove the bulk order items. Continue?'),
        confirmText: tr('Yes, remove and add'), cancelText: tr('Keep bulk order'), destructive: true, icon: 'cube-outline',
    }).then((yes) => {
        if (!yes) return;
        useBulkCartStore.getState().clear();
        useCartStore.getState().add(line);
    });
    return false;
};

// The bulk menu is starting a bulk cart while a normal cart has dishes: the same question the other way round. Returns true when he said yes
// (and the normal cart is emptied), or when there is nothing to ask about.
export async function allowBulkStart() {
    if (!useCartStore.getState().lines.length) return true;
    const yes = await ask({
        title: tr('Remove your cart?'),
        message: tr('Your cart has dishes for a normal order. Starting a bulk order will remove them. Continue?'),
        confirmText: tr('Yes, start bulk order'), cancelText: tr('Keep my cart'), destructive: true, icon: 'bag-handle-outline',
    });
    if (yes) useCartStore.getState().clear();
    return !!yes;
}
