import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// Kitchen and waiter API (/api/staff). Only an active staff member whose panel is switched on may call these.
// who I am and which shop: { userId, role, job, name, phone, shop, shopPhone }
export const fetchStaffMe = () => d(api.get('/staff/me'));
export const saveTellDone = (tellDone) => d(api.patch('/staff/me', { tellDone }));   // a cook: be told when an order left the kitchen
// working time: { status, onDuty, online, mode, weekly, holidays, today }
export const fetchDuty = () => d(api.get('/staff/duty'));
export const saveDuty = (body) => d(api.put('/staff/duty', body));   // { online?, mode?, weekly? }
export const askLeave = (body) => d(api.post('/staff/duty/leave', body));   // { from, to, reason }: the owner approves or rejects
export const cancelLeave = (id) => d(api.post(`/staff/duty/leave/${id}/cancel`));
export const addDayOff = (body) => d(api.post('/staff/duty/holidays', body));   // { from, to, note? }
export const removeDayOff = (id) => d(api.delete(`/staff/duty/holidays/${id}`));
export const saveStaffName = (name) => d(api.patch('/staff/me', { name }));

// The kitchen (role "kitchen"): { items, counts, rules, now }
export const fetchKitchenOrders = () => d(api.get('/staff/kitchen/orders'));
export const kitchenStart = (id) => d(api.post(`/staff/kitchen/orders/${id}/start`));   // { already, by?, ago?, order }
export const kitchenReady = (id) => d(api.post(`/staff/kitchen/orders/${id}/ready`));
export const kitchenUndo = (id) => d(api.post(`/staff/kitchen/orders/${id}/undo`));   // takes the last Start cooking / Ready back
export const kitchenProblem = (id, body) => d(api.post(`/staff/kitchen/orders/${id}/problem`, body));   // { kind: 'out_of_stock' | 'cannot_make' | 'other', note?, productId? }

// The waiter (role "waiter"): { serve, requests, tables, counts, rules, now }
export const fetchWaiterOverview = () => d(api.get('/staff/waiter/overview'));
export const waiterServe = (id) => d(api.post(`/staff/waiter/orders/${id}/serve`));   // { already, ago? }
export const waiterUndo = (id) => d(api.post(`/staff/waiter/orders/${id}/undo`));   // takes a mistaken Served back
export const waiterDoneRequest = (id) => d(api.post(`/staff/waiter/requests/${id}/done`));
export const fetchTableBill = (sessionId) => d(api.get(`/staff/waiter/tables/${sessionId}`));   // the bill, with canSettle
export const fetchPayQr = (sessionId) => d(api.get(`/staff/waiter/tables/${sessionId}/pay-qr`));   // { available, payable, image?, upiId?, reason? }
export const waiterSettle = (sessionId, method) => d(api.post(`/staff/waiter/tables/${sessionId}/settle`, { method }));   // 'cash' | 'upi'
