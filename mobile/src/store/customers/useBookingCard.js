// The guest's booked table, from the moment the owner allowed it until its slot is over (the table card, components/customers/BookingStrip.jsx).
import { create } from 'zustand';
import { fetchBookingCard } from '../../api/customers/shopApi';

export const useBookingCard = create((set) => ({
    card: null,        // { id, code, date, time, party, startsAt, endsAt } or null
    orderBar: false,   // the active order bar is on screen: the table card sits above it
    load: async () => {
        try { set({ card: (await fetchBookingCard()).card || null }); } catch (e) { /* the last card stays on screen */ }
    },
    setOrderBar: (orderBar) => set({ orderBar }),
    reset: () => set({ card: null }),
}));
