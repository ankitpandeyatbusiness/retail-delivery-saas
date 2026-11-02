// The chat between a customer and the owner (backend/src/routes/chatRouter.js). The same calls for both; the path says which side is asking.
import api from './client';
import { useAuthStore } from '../../store/common/useAuthStore';

const d = (p) => p.then((r) => r.data);
const base = () => (useAuthStore.getState().user?.role === 'admin' ? '/shop/chat' : '/chat');

export const chatApi = {
    list: (kind, id, read) => d(api.get(`${base()}/${kind}/${id}`, { params: read ? { read: 1 } : undefined })),     // { items, closed, closesAt, title }
    send: (kind, id, body) => d(api.post(`${base()}/${kind}/${id}`, body)),                                          // { text?, images?, voice?, clientId } -> the saved message
    ack: (kind, id, ids) => d(api.post(`${base()}/${kind}/${id}/ack`, { ids })),                                      // delivered
    read: (kind, id) => d(api.post(`${base()}/${kind}/${id}/read`)),                                                  // the chat is open: read
    typing: (kind, id) => d(api.post(`${base()}/${kind}/${id}/typing`)),
    unread: () => d(api.get(`${base()}/unread`)),                                                                    // { total, byRef }
};
