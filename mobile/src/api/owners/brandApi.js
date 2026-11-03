// The brand owner's routes (backend/src/routes/brandOwnerRouter.js). Only a brand owner gets an answer; everybody else gets 403.
import api from '../common/client';

const d = (p) => p.then((r) => r.data);

export const fetchBrandMe = () => d(api.get('/brand/me'));                                   // { brand, current, branches: [{ slug, name, city, status }] }
export const fetchBrandOverview = (range = 'today') => d(api.get('/brand/overview', { params: { range } }));   // { branches, totals }
export const fetchBrandOrders = (params) => d(api.get('/brand/orders', { params }));          // { items, hasMore } each with its branch
export const fetchBrandStatement = (period) => d(api.get('/brand/statement', { params: { period } }));
export const pushMenu = (body) => d(api.post('/brand/menu/push', body));                      // { productIds, toSlugs: 'all' | [slug], prices }
