import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---- the common settlement sheet between the two partners ---- */
export const fetchSettlementSummary = (month) => data(api.get('/admin/settlement/summary', { params: { month } }));
export const fetchSettlementEntries = (params) => data(api.get('/admin/settlement/entries', { params }));   // { status: open|late|paid, kind, month, tenantId, page }
export const fetchSettlementEntry = (id) => data(api.get(`/admin/settlement/entries/${id}`));
export const fetchSettlementConfig = () => data(api.get('/admin/settlement/config'));

// the supreme admin only (the server refuses everybody else)
export const saveSettlementConfig = (body) => data(api.put('/admin/settlement/config', body));
export const addSettlementCost = (body) => data(api.post('/admin/settlement/costs', body));                  // { category, title, amount, paidBy, date, note }
export const addSettlementAdjustment = (body) => data(api.post('/admin/settlement/adjustments', body));     // { owes, amount, reason, date }
export const markSettlementPaid = (id, body) => data(api.post(`/admin/settlement/entries/${id}/paid`, body));   // { amount, date, ref, note }
export const confirmSettlementClaim = (id) => data(api.post(`/admin/settlement/entries/${id}/claim/confirm`));
export const rejectSettlementClaim = (id, note) => data(api.post(`/admin/settlement/entries/${id}/claim/reject`, { note }));
export const setOffSettlement = (body) => data(api.post('/admin/settlement/setoff', body));                   // { fromPartnerId, fromOwnerId, amount, reason }
export const setShopBroughtBy = (shopId, broughtBy) => data(api.put(`/admin/settlement/shops/${shopId}/brought-by`, { broughtBy }));

// anybody with a superadmin login: "I have paid" (a note until the supreme admin confirms it)
export const claimSettlementPaid = (id, body) => data(api.post(`/admin/settlement/entries/${id}/claim`, body));   // { amount, date, ref, note }

export async function shareSettlement(month) {
    const res = await api.get('/admin/settlement/export', { params: month ? { month } : {}, responseType: 'arraybuffer' });
    const file = new File(Paths.cache, `settlement${month ? `-${month}` : ''}-${Date.now()}.xlsx`);
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Settlement sheet', UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
}
