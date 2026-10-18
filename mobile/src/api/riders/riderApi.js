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
// extra: { lat, lng } where he is now, and farOk: true when he chose "deliver anyway" after the server said he is far from the customer
export const deliverOrder = (id, pin, extra = {}) => d(api.post(`/rider/orders/${id}/deliver`, { pin, ...extra }));
export const fetchRiderOrder = (id) => d(api.get(`/rider/orders/${id}`));
export const fetchSummary = () => d(api.get('/rider/summary'));   // { earnings, deliveries: { today, month, total }, cash }
// his money in one page: the cash he holds (and the limit) and what he earns (left out when the shop pays outside the app)
export const fetchMoney = () => d(api.get('/rider/money'));
export const markArrived = (id) => d(api.post(`/rider/orders/${id}/arrived`));
export const releaseOrder = (id, note) => d(api.post(`/rider/orders/${id}/release`, { note }));   // before pickup only
// a Cash on delivery customer pays by QR at the door: start -> { qr }, then ask until { paid: true }
export const startDoorPay = (id) => d(api.post(`/rider/orders/${id}/door-pay`));
export const checkDoorPay = (id) => d(api.get(`/rider/orders/${id}/door-pay`));
export const reportProblem = (id, reason, note) => d(api.post(`/rider/orders/${id}/problem`, { reason, note }));
export const sendLocation = (lat, lng) => d(api.post('/rider/location', { lat, lng }));

// his own picture: sign -> PUT the file -> confirm. photo is the stored picture address.
export const signMyPhoto = (body) => d(api.post('/rider/me/photo/sign', body));
export const confirmMyPhoto = (key) => d(api.post('/rider/me/photo', { key }));
export const deleteMyPhoto = () => d(api.delete('/rider/me/photo'));
// proof of a safe delivery: the photo of the food handed over to the customer (optional)
export const signProof = (id, body) => d(api.post(`/rider/orders/${id}/proof/sign`, body));
export const confirmProof = (id, key) => d(api.post(`/rider/orders/${id}/proof`, { key }));
export const deleteProof = (id) => d(api.delete(`/rider/orders/${id}/proof`));
