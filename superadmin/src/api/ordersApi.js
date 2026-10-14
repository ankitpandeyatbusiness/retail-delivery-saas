import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---- orders of every shop (superadmin routes) ---- */
export const listOrders = (params) => data(api.get('/admin/orders', { params }));
export const getOrder = (id) => data(api.get(`/admin/orders/${id}`));
// body { status, note?, reasonCode? }   reasonCode for cancel: platform | shop_fault | customer_fault
export const changeOrderStatus = (id, body) => data(api.patch(`/admin/orders/${id}/status`, body));
export const fetchSalesReport = (params) => data(api.get('/admin/reports/sales', { params }));

// The invoice is a PDF behind the login: fetch it with the token, save it to the cache, hand it to the share sheet.
export async function shareInvoice(order) {
    const res = await api.get(`/admin/orders/${order.id}/invoice`, { responseType: 'arraybuffer' });
    const file = new File(Paths.cache, `invoice-${order.orderNo}.pdf`);
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${order.orderNo}`, UTI: 'com.adobe.pdf' });
}

/* ---- delivery of one order (through the shop's own routes) ---- */
const S = (shopId) => `/admin/tenants/${shopId}/shop`;
export const getDelivery = (shopId, orderId) => data(api.get(`${S(shopId)}/orders/${orderId}/delivery`));
export const assignRider = (shopId, orderId, body) => data(api.post(`${S(shopId)}/orders/${orderId}/assign`, body));   // { riderId } or { auto: true }, reason when changing
export const unassignRider = (shopId, orderId, reason) => data(api.post(`${S(shopId)}/orders/${orderId}/unassign`, { reason }));
