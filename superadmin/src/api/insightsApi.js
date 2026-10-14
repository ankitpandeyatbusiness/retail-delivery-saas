import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---------------- search, health, readiness ---------------- */
export const searchAll = (q) => data(api.get('/admin/search', { params: { q } }));
export const fetchHealth = (days) => data(api.get('/admin/insights/health', { params: { days } }));
export const fetchReadiness = (shopId) => data(api.get(`/admin/tenants/${shopId}/readiness`));

/* ---------------- system and backups ---------------- */
export const fetchSystem = () => data(api.get('/admin/ops/system'));
export const fetchBackups = () => data(api.get('/admin/ops/backups'));
export const runBackup = () => data(api.post('/admin/ops/backup', {}, { timeout: 180000 }));

/* ---------------- profit and loss, who owes, expenses ---------------- */
export const fetchProfitLoss = (months) => data(api.get('/admin/finance/summary', { params: { months } }));
export const fetchReceivables = () => data(api.get('/admin/finance/receivables'));
export const listExpenses = () => data(api.get('/admin/finance/expenses'));
export const addExpense = (body) => data(api.post('/admin/finance/expenses', body));              // { date, category, amountPaise, vendor?, note?, repeatMonthly?, endsOn? }
export const updateExpense = (id, body) => data(api.patch(`/admin/finance/expenses/${id}`, body));
export const deleteExpense = (id) => data(api.delete(`/admin/finance/expenses/${id}`));

/* ---------------- Excel exports (behind the login: fetch, save, share) ---------------- */
const sheetOpts = (params) => ({ params, responseType: 'arraybuffer' });

async function saveAndShare(res, name) {
    const file = new File(Paths.cache, `${name}-${Date.now()}.xlsx`);
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: name,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
}

export const shareOrdersCsv = async (params) => saveAndShare(await api.get('/admin/export/orders', sheetOpts(params)), 'orders');
export const shareInvoicesCsv = async (params) => saveAndShare(await api.get('/admin/export/invoices', sheetOpts(params)), 'invoices');
export const shareCustomersCsv = async (params) => saveAndShare(await api.get('/admin/export/customers', sheetOpts(params)), 'customers');
