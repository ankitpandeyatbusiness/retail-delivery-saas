// Whether this shop offers Services (and inquiries) and Table booking, kept between openings of the Account screen so the
// SERVICES section is there on the first frame instead of popping in (and moving everything below it) after two requests.
import { create } from 'zustand';
import { readCache, writeCache } from '../common/cache';
import { fetchServices, fetchBookingConfig, fetchBulkConfig } from '../../api/customers/shopApi';

const KEY = 'serviceFlags';

export const useServiceFlags = create((set, get) => ({
    serviceCount: 0, only: null, bookingOn: false, bulkOn: false, bulkPaused: false, ready: false,   // only: { id, name, icon, paused } when the shop has exactly one live service (its row shows its own name)
    hydrate: async () => {
        if (get().ready) return;
        const c = await readCache(KEY);
        set({ serviceCount: Number(c?.serviceCount) || 0, only: c?.only || null, bookingOn: c?.bookingOn === true, bulkOn: c?.bulkOn === true, bulkPaused: c?.bulkPaused === true, ready: true });
    },
    // asks the server; only a different answer changes the screen
    refresh: async () => {
        const [s, b, k] = await Promise.all([fetchServices().catch(() => null), fetchBookingConfig().catch(() => null), fetchBulkConfig().catch(() => null)]);
        const list = s?.items || [];
        const next = {
            ...(s ? { serviceCount: list.length, only: list.length === 1 ? { id: String(list[0]._id), name: list[0].name, icon: list[0].icon || 'sparkles-outline', paused: !!list[0].paused } : null } : {}),
            ...(b ? { bookingOn: !!b.enabled } : {}), ...(k ? { bulkOn: !!k.enabled, bulkPaused: !!k.paused } : {}),
        };
        set(next);
        const x = get();
        writeCache(KEY, { serviceCount: x.serviceCount, only: x.only, bookingOn: x.bookingOn, bulkOn: x.bulkOn, bulkPaused: x.bulkPaused });
    },
}));

useServiceFlags.getState().hydrate();   // starts reading as soon as the app loads
