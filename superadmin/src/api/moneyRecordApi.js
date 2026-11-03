import api, { data } from './adminClient';

/* ---- what shops paid each month, and the developer's "did you get your part?" ---- */
// { month, groups: [{ brandId, name, base, yourPart, shops: [{ tenantId, name, branchCity, broughtBy, pct, base, yourPart, lines, check, state }] }], totals }
// state: 'open' (not answered) | 'yes' | 'no' | 'again' (a payment or the "brought by" changed after it was answered)
export const fetchMoneyRecord = (month) => data(api.get('/admin/money-record', { params: month ? { month } : {} }));

// the supreme admin only (the server refuses everybody else)
export const answerMoneyCheck = (body) => data(api.put('/admin/money-record/check', body));                                  // { month, tenantId, got, reason }
export const setShopBroughtBy = (shopId, broughtBy) => data(api.put(`/admin/money-record/shops/${shopId}/brought-by`, { broughtBy }));
