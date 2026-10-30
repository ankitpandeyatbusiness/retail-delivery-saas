// The guest's booked table, from the moment the owner allowed it until its slot is over (the table card, components/customers/BookingStrip.jsx).
// Kept on the phone, so the card and "My ticket" still open with no signal; the ticket itself is saved here too (components/customers/BookingTicket.jsx).
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchBookingCard, fetchBookingTicket } from '../../api/customers/shopApi';
import { readCache, writeCache } from '../../utils/common/cache';

const KEY = 'bookingCard';
const live = (c) => !!c && new Date(c.endsAt).getTime() > Date.now();

export const useBookingCard = create((set, get) => ({
    card: null,        // { id, code, date, time, party, startsAt, endsAt } or null
    ready: false,      // what was kept on the phone has been read
    hidden: false,     // the guest hid the card (a small chip is left); a different booking shows it again
    orderBar: false,   // the active order bar is on screen: the table card sits above it
    hydrate: async () => {
        if (get().ready) return;
        const c = await readCache(KEY);
        set((s) => ({ card: s.card || (live(c) ? c : null), ready: true }));
    },
    load: async () => {
        try {
            const card = (await fetchBookingCard()).card || null;
            set((s) => ({ card, ready: true, hidden: s.card?.id === card?.id ? s.hidden : false }));
            writeCache(KEY, card);
            // keep the ticket (the QR) on the phone now, while there is a signal
            if (card) fetchBookingTicket(card.id).then((t) => AsyncStorage.setItem(`ticket:${card.id}`, JSON.stringify(t))).catch(() => { });
        } catch (e) { set({ ready: true }); /* no signal: the card kept on the phone stays */ }
    },
    setOrderBar: (orderBar) => set({ orderBar }),
    setHidden: (hidden) => set({ hidden }),
    reset: () => { set({ card: null }); writeCache(KEY, null); },
}));

useBookingCard.getState().hydrate();   // starts reading as soon as the app loads
