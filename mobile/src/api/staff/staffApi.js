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
