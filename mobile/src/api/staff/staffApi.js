import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// Kitchen and waiter API (/api/staff). Only an active staff member whose panel is switched on may call these.
// who I am and which shop: { userId, role, job, name, phone, shop, shopPhone }
export const fetchStaffMe = () => d(api.get('/staff/me'));
export const saveStaffName = (name) => d(api.patch('/staff/me', { name }));

// The kitchen (role "kitchen"): { items, counts, rules, now }
export const fetchKitchenOrders = () => d(api.get('/staff/kitchen/orders'));
export const kitchenStart = (id) => d(api.post(`/staff/kitchen/orders/${id}/start`));   // { already, by?, ago?, order }
export const kitchenReady = (id) => d(api.post(`/staff/kitchen/orders/${id}/ready`));
export const kitchenProblem = (id, body) => d(api.post(`/staff/kitchen/orders/${id}/problem`, body));   // { kind: 'out_of_stock' | 'cannot_make' | 'other', note?, productId? }

// The waiter (role "waiter"): { serve, requests, tables, counts, rules, now }
export const fetchWaiterOverview = () => d(api.get('/staff/waiter/overview'));
export const waiterServe = (id) => d(api.post(`/staff/waiter/orders/${id}/serve`));   // { already, ago? }
export const waiterDoneRequest = (id) => d(api.post(`/staff/waiter/requests/${id}/done`));
export const fetchTableBill = (sessionId) => d(api.get(`/staff/waiter/tables/${sessionId}`));   // the bill, with canSettle
export const waiterSettle = (sessionId, method) => d(api.post(`/staff/waiter/tables/${sessionId}/settle`, { method }));   // 'cash' | 'upi'
