// Whether this shop offers Services (and inquiries) and Table booking, kept between openings of the Account screen so the
// SERVICES section is there on the first frame instead of popping in (and moving everything below it) after two requests.
import { create } from 'zustand';
import { readCache, writeCache } from '../common/cache';
import { fetchServices, fetchBookingConfig } from '../../api/customers/shopApi';

const KEY = 'serviceFlags';

export const useServiceFlags = create((set, get) => ({
    serviceCount: 0, bookingOn: false, ready: false,
    hydrate: async () => {
        if (get().ready) return;
        const c = await readCache(KEY);
        set({ serviceCount: Number(c?.serviceCount) || 0, bookingOn: c?.bookingOn === true, ready: true });
    },
    // asks the server; only a different answer changes the screen
    refresh: async () => {
        const [s, b] = await Promise.all([fetchServices().catch(() => null), fetchBookingConfig().catch(() => null)]);
        const next = { ...(s ? { serviceCount: (s.items || []).length } : {}), ...(b ? { bookingOn: !!b.enabled } : {}) };
        set(next);
        const x = get();
        writeCache(KEY, { serviceCount: x.serviceCount, bookingOn: x.bookingOn });
    },
}));

useServiceFlags.getState().hydrate();   // starts reading as soon as the app loads
