import api, { data } from './adminClient';

// The desktop website's login backgrounds: a library on the CDN, one default per business type, and a pick per shop.
// (backend/src/routes/adminLoginBgRouter.js)
export const fetchLoginBgs = () => data(api.get('/admin/login-backgrounds'));
export const signLoginBg = (body) => data(api.post('/admin/login-backgrounds/sign', body));
export const confirmLoginBg = (body) => data(api.post('/admin/login-backgrounds/confirm', body));
export const setLoginBgDefault = (businessType, file) => data(api.put('/admin/login-backgrounds/default', { businessType, file }));
export const deleteLoginBg = (businessType, file) => data(api.delete('/admin/login-backgrounds', { params: { businessType, file } }));
// one shop's pick: rel = "<businessType>/<name>.webp", or null for the default of its business type
export const setShopLoginBg = (shopId, rel) => data(api.put(`/admin/tenants/${shopId}/login-bg`, { rel }));
