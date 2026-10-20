import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// Kitchen and waiter API (/api/staff). Only an active staff member whose panel is switched on may call these.
// who I am and which shop: { userId, role, job, name, phone, shop, shopPhone }
export const fetchStaffMe = () => d(api.get('/staff/me'));
export const saveStaffName = (name) => d(api.patch('/staff/me', { name }));
