// Chats at a glance: which chat is open on screen (its messages are read at once and make no sound) and how many unread messages each chat has
// (for the badges on the lists). The numbers come from the server; a live message adds one.
import { create } from 'zustand';
import { chatApi } from '../../api/common/chatApi';

export const useChatStore = create((set, get) => ({
    open: null,                    // 'bulk:<id>' while that chat is on screen
    total: 0,
    byRef: {},
    setOpen: (key) => set({ open: key }),
    load: async () => {
        try { const r = await chatApi.unread(); set({ total: r.total || 0, byRef: r.byRef || {} }); } catch (e) { /* the badges stay as they were */ }
    },
    bump: (kind, refId) => set((s) => { const k = `${kind}:${refId}`; return { total: s.total + 1, byRef: { ...s.byRef, [k]: (s.byRef[k] || 0) + 1 } }; }),
    clear: (kind, refId) => set((s) => { const k = `${kind}:${refId}`; const n = s.byRef[k] || 0; const byRef = { ...s.byRef }; delete byRef[k]; return { total: Math.max(0, s.total - n), byRef }; }),
    reset: () => set({ open: null, total: 0, byRef: {} }),
}));
export const unreadOf = (kind, refId) => (s) => s.byRef[`${kind}:${refId}`] || 0;
