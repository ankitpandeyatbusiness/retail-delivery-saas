import api, { data } from './adminClient';

/* ---- a shop's progress report (the same one its owner sees) ---- */
export const fetchShopReport = (shopId, range) => data(api.get(`/admin/tenants/${shopId}/shop/business-report`, { params: { range } }));   // range: 7 | 30 | 90 | 2026-09

/* ---- how the report is presented to owners ---- */
export const fetchInsightsSettings = () => data(api.get('/admin/platform/insights'));                   // { showMarketplaceCompare, marketplaceCommissionPct, monthlyReportEmail }
export const saveInsightsSettings = (body) => data(api.put('/admin/platform/insights', body));         // any of those, or { reset: true }

/* ---- how the shops are growing, and Autopilot (reminders a shop sends its customers) ---- */
export const fetchShopsGrowth = (days) => data(api.get('/admin/platform/shops-growth', { params: { days } }));
export const fetchShopAutopilot = (shopId) => data(api.get(`/admin/tenants/${shopId}/autopilot`));
export const pauseShopAutopilot = (shopId, paused) => data(api.put(`/admin/tenants/${shopId}/autopilot`, { paused }));
