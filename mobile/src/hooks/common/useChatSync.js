// Keeps the chat badges right and tells the sender "delivered": every chat message that reaches this phone (the chat itself is not open) adds one to
// the unread count of that chat and is acknowledged to the server, which turns the sender's tick into two. Mounted once, for customers and owners.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { onChatMessage } from '../../api/common/socket';
import { chatApi } from '../../api/common/chatApi';
import { useChatStore } from '../../store/common/useChatStore';
import { useAuthStore } from '../../store/common/useAuthStore';

export default function useChatSync() {
    const role = useAuthStore((s) => s.user?.role);
    const on = !!role && !['rider', 'kitchen', 'waiter'].includes(role);
    useEffect(() => {
        if (!on) { useChatStore.getState().reset(); return undefined; }
        const store = useChatStore.getState();
        store.load();
        const off = onChatMessage((p) => {
            if (p.echo) return;   // my own message from my other phone
            if (useChatStore.getState().open === `${p.kind}:${p.refId}`) return;   // the chat is open: it reads the message itself
            useChatStore.getState().bump(p.kind, p.refId);
            chatApi.ack(p.kind, p.refId, [p.message.id]).catch(() => { });
        });
        const app = AppState.addEventListener('change', (st) => { if (st === 'active') useChatStore.getState().load(); });
        return () => { off(); app.remove(); };
    }, [on]);
}
