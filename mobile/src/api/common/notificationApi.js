import api from './client';

const d = (p) => p.then((r) => r.data);

// inbox: { items: [{ id, type, title, body, data, read, createdAt }], unreadCount, page, hasMore }
export const fetchInbox = (params) => d(api.get('/notifications', { params }));
export const markRead = (id) => d(api.post(`/notifications/${id}/read`));
export const markAllRead = () => d(api.post('/notifications/read-all'));
export const clearAll = () => d(api.delete('/notifications'));   // deletes every message of this customer

// push: the server stores the phone's FCM token for the logged-in customer
// loudAlerts (owner phones): false = Soundbox is off here, so the server sends no loud new-order sound to this phone
export const registerDevice = (token, platform = 'android', loudAlerts) => d(api.post('/notifications/devices', {
    token, platform, ...(typeof loudAlerts === 'boolean' ? { loudAlerts } : {}),
}));
export const removeDevice = (token) => d(api.post('/notifications/devices/remove', { token }));
