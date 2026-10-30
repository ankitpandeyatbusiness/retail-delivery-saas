import api, { data } from './adminClient';

// Services, inquiries and table booking, seen from above (backend/src/routes/adminServicesRouter.js). Everything is read-only except the defaults:
// the replies and the bookings belong to the owner of each shop. The per-shop switches are in "App features".
export const fetchServicesOverview = (params) => data(api.get('/admin/services/overview', { params }));          // { days, reminderHours, totals, shops: [...] }; params: { days, tenantId }
export const fetchServiceInquiries = (params) => data(api.get('/admin/services/inquiries', { params }));       // { tenantId, status, days, page, limit }
export const fetchServiceInquiry = (id) => data(api.get(`/admin/services/inquiries/${id}`));
export const fetchServiceBookings = (params) => data(api.get('/admin/services/bookings', { params }));         // { tenantId, status, days, date, page, limit }
export const fetchServicesDefaults = () => data(api.get('/admin/services/defaults'));
export const saveServicesDefaults = (body) => data(api.put('/admin/services/defaults', body));                 // { reminderHours?, kinds?: { bulk: { quickTexts, quickReplies } } }
export const resetServicesDefault = (kind) => data(api.post('/admin/services/defaults/reset', { kind }));
