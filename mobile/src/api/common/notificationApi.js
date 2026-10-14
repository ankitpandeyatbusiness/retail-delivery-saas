import api from './client';

const d = (p) => p.then((r) => r.data);

// inbox: { items: [{ id, type, title, body, data, read, createdAt }], unreadCount, page, hasMore }
export const fetchInbox = (params) => d(api.get('/notifications', { params }));
export const markRead = (id) => d(api.post(`/notifications/${id}/read`));
export const markAllRead = () => d(api.post('/notifications/read-all'));
export const clearAll = () => d(api.delete('/notifications'));   // deletes every message of this customer

// push: the server stores the phone's FCM token for the logged-in customer
export const registerDevice = (token, platform = 'android') => d(api.post('/notifications/devices', { token, platform }));
export const removeDevice = (token) => d(api.post('/notifications/devices/remove', { token }));
