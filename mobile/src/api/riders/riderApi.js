import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// Rider API (/api/rider). Only a user with role "rider" may call these.
export const fetchRiderMe = () => d(api.get('/rider/me'));
export const setOnline = (isOnline) => d(api.put('/rider/online', { isOnline }));
// tab: offered | active | history  -> { items, counts: { offered, active }, page, hasMore }
export const fetchRiderOrders = (tab, page = 1) => d(api.get('/rider/orders', { params: { tab, page, limit: 20 } }));
export const acceptOrder = (id) => d(api.post(`/rider/orders/${id}/accept`));
export const rejectOrder = (id) => d(api.post(`/rider/orders/${id}/reject`));
export const pickupOrder = (id) => d(api.post(`/rider/orders/${id}/pickup`));
export const deliverOrder = (id, pin) => d(api.post(`/rider/orders/${id}/deliver`, { pin }));
export const reportProblem = (id, reason, note) => d(api.post(`/rider/orders/${id}/problem`, { reason, note }));
export const sendLocation = (lat, lng) => d(api.post('/rider/location', { lat, lng }));
