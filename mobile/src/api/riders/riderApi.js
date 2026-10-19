import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// Rider API (/api/rider). Only a user with role "rider" may call these.
export const fetchRiderMe = () => d(api.get('/rider/me'));
export const setOnline = (isOnline) => d(api.put('/rider/online', { isOnline }));
// duty timing, holidays and leave (services/riderSchedule.js)
export const fetchDuty = () => d(api.get('/rider/duty'));
export const saveDuty = (body) => d(api.put('/rider/duty', body));   // { mode?, weekly? }
export const addHoliday = (body) => d(api.post('/rider/duty/holidays', body));   // { from, to, note? }
export const removeHoliday = (id) => d(api.delete(`/rider/duty/holidays/${id}`));
export const requestLeave = (body) => d(api.post('/rider/leaves', body));   // { from, to, reason }
export const cancelLeave = (id) => d(api.post(`/rider/leaves/${id}/cancel`));
// tab: offered | active | history  -> { items, counts: { offered, active }, page, hasMore }
// tab "missed": offers whose time ran out. since (ISO time): counts.missed = how many he missed after it (the History red dot)
export const fetchRiderOrders = (tab, page = 1, since) => d(api.get('/rider/orders', { params: { tab, page, limit: 20, since } }));
// the fixed road from the shop to the customer: { source: 'google' | 'estimate', polyline, distanceM, durationSec, allowedSec }
export const fetchRoute = (id, lat, lng) => d(api.get(`/rider/orders/${id}/route`, { params: { lat, lng } }));
export const acceptOrder =(id) => d(api.post(`/rider/orders/${id}/accept`));
export const rejectOrder = (id) => d(api.post(`/rider/orders/${id}/reject`));
export const pickupOrder = (id) => d(api.post(`/rider/orders/${id}/pickup`));
// extra: { lat, lng } where he is now, and farOk: true when he chose "deliver anyway" after the server said he is far from the customer
export const deliverOrder = (id, pin, extra = {}) => d(api.post(`/rider/orders/${id}/deliver`, { pin, ...extra }));
export const fetchRiderOrder = (id) => d(api.get(`/rider/orders/${id}`));
export const fetchSummary = () => d(api.get('/rider/summary'));   // { earnings, deliveries: { today, month, total }, cash }
// his money in one page: the cash he holds (and the limit) and what he earns (left out when the shop pays outside the app)
export const fetchMoney = () => d(api.get('/rider/money'));
// the help button: the shop is told at once (name, phone, order, last position)
export const sendSos = (orderId) => d(api.post('/rider/sos', orderId ? { orderId } : {}));
export const markArrived = (id) => d(api.post(`/rider/orders/${id}/arrived`));
// he cannot finish a delivery he is carrying (after pickup): cancel it. reasonCode is from the list; the note is optional.
export const cancelDelivery = (id, reasonCode, note) => d(api.post(`/rider/orders/${id}/cancel`, { reasonCode, note }));
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
