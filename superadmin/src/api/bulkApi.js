// Bulk orders of one shop, for the super admin. The server's owner routes are open to him for any shop (/admin/tenants/:tid/shop/...).
import api, { data } from './adminClient';

const S = (shopId) => `/admin/tenants/${shopId}/shop/bulk`;

export const bulkRules = (shopId) => data(api.get(`${S(shopId)}/settings`));                       // the rules + featureOn (the App features switch)
export const saveBulkRules = (shopId, body) => data(api.put(`${S(shopId)}/settings`, body));
export const listBulkOrders = (shopId, params) => data(api.get(S(shopId), { params }));          // { items, hasMore, page } (read only here)
export const cancelBulkOrder = (shopId, id, reason) => data(api.post(`${S(shopId)}/${id}/cancel`, { reason }));          // the shop's cancel: the customer gets the whole advance back
export const bulkCashReceived = (shopId, id, via) => data(api.post(`${S(shopId)}/${id}/cash-received`, { via }));   // the balance was paid in cash or by UPI
