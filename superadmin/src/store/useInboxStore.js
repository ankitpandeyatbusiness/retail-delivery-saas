import { create } from 'zustand';
import { fetchInbox } from '../api/platformApi';

// Only the unread number, for the bell. The inbox screen loads its own list.
export const useInboxStore = create((set) => ({
    unread: 0,
    async refresh() {
        try {
            const r = await fetchInbox({ unread: 'true', limit: 1 });
            set({ unread: r.unreadCount || 0 });
        } catch (e) { /* the bell just keeps its last number */ }
    },
    setUnread: (n) => set({ unread: Math.max(0, n) }),
}));
