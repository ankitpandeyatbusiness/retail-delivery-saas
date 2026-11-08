// What the side menu needs to know before it opens, kept between openings so it never changes shape while the owner watches:
//   kitchenOn / waiterOn  the jobs the platform switched on for this shop (the Kitchen staff and Waiters rows)
//   sortAZ                the menu as one list by name (A to Z): ON by default; the owner can switch it off, and his choice (azChosen) is kept
//   easy                  Easy mode: only the things a shop uses every day are shown (the owner's own switch, kept on this phone)
import { create } from 'zustand';
import { readCache, writeCache } from '../common/cache';
import { fetchSettings } from '../../api/owners/shopApi';
import { ease } from '../common/ease';

const KEY = 'menuFlags';

export const useMenuFlags = create((set, get) => ({
    kitchenOn: false, waiterOn: false, servicesOn: false, bookingOn: false, bulkOn: false, busy: null, easy: false, sortAZ: true, azChosen: false, ready: false,
    hydrate: async () => {
        if (get().ready) return;
        const c = await readCache(KEY);
        set({ kitchenOn: c?.kitchenOn === true, waiterOn: c?.waiterOn === true, servicesOn: c?.servicesOn === true, bookingOn: c?.bookingOn === true, bulkOn: c?.bulkOn === true, easy: c?.easy === true, azChosen: c?.azChosen === true, sortAZ: c?.azChosen === true ? c.sortAZ === true : true, ready: true });
    },
    // asks the server; the rows only change when the answer is different from what was kept
    refresh: async () => {
        try {
            const x = await fetchSettings();
            const st = x.orders?.staff;
            const next = {
                busy: x.orders?.busy || null, ...(st ? { kitchenOn: st.kitchenOn === true, waiterOn: st.waiterOn === true } : {}),
                ...(x.addons ? { servicesOn: x.addons.services === true, bookingOn: x.addons.tableBooking === true, bulkOn: x.addons.bulkOrders === true } : {}),
            };
            set(next);
            const s = get();
            writeCache(KEY, { kitchenOn: s.kitchenOn, waiterOn: s.waiterOn, servicesOn: s.servicesOn, bookingOn: s.bookingOn, bulkOn: s.bulkOn, easy: s.easy, sortAZ: s.sortAZ, azChosen: s.azChosen });
            return x;
        } catch (e) { return null; }
    },
    setBusy: (busy) => set({ busy }),
    // both switches glide: every screen that shows less or more eases to its new shape instead of jumping

    setEasy: (easy) => { ease(); set({ easy }); const s = get(); writeCache(KEY, { kitchenOn: s.kitchenOn, waiterOn: s.waiterOn, servicesOn: s.servicesOn, bookingOn: s.bookingOn, bulkOn: s.bulkOn, easy, sortAZ: s.sortAZ, azChosen: s.azChosen }); },
    // the menu as one list by name, with the A to Z strip (English only)
    setSortAZ: (sortAZ) => { ease(); set({ sortAZ, azChosen: true }); const s = get(); writeCache(KEY, { kitchenOn: s.kitchenOn, waiterOn: s.waiterOn, servicesOn: s.servicesOn, bookingOn: s.bookingOn, bulkOn: s.bulkOn, easy: s.easy, sortAZ, azChosen: true }); },
}));

useMenuFlags.getState().hydrate();   // starts reading as soon as the app loads
