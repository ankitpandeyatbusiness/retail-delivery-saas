import { create } from 'zustand';
import { fetchInbox } from '../../api/common/notificationApi';
import { useAuthStore } from './useAuthStore';

// Only the unread number: it drives the bell badge. The list itself is loaded by the Notifications screen.
export const useNotificationStore = create((set) => ({
    unread: 0,
    set: (n) => set({ unread: Math.max(0, n | 0) }),
    bump: () => set((s) => ({ unread: s.unread + 1 })),
    drop: (n = 1) => set((s) => ({ unread: Math.max(0, s.unread - n) })),
    reset: () => set({ unread: 0 }),
    refresh: async () => {
        if (!useAuthStore.getState().user) return;
        try {
            const r = await fetchInbox({ limit: 1 });
            set({ unread: r.unreadCount || 0 });
        } catch (e) { /* keep the old number */ }
    },
}));
