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
export const fetchProfitLossBy = (period, count) => data(api.get('/admin/finance/summary', { params: { period, count } }));   // week, month or financial year
export const fetchProfitPeriods = () => data(api.get('/admin/finance/periods'));                                          // this week, month and year with the one before
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

export const shareOrdersExcel = async (params) => saveAndShare(await api.get('/admin/export/orders', sheetOpts(params)), 'orders');
export const shareInvoicesExcel = async (params) => saveAndShare(await api.get('/admin/export/invoices', sheetOpts(params)), 'invoices');
export const shareCustomersExcel = async (params) => saveAndShare(await api.get('/admin/export/customers', sheetOpts(params)), 'customers');

// the customers of every shop with what each one did (masked phones; full=1 only for the supreme admin) and the same list as Excel
export const listCustomers = (params) => data(api.get("/admin/customers", { params }));
export const shareCustomerListExcel = async (params) => saveAndShare(await api.get("/admin/customers/export", sheetOpts(params)), "customers");

// the whole sales report as one Excel file (a sheet each): same ?from=&to=&tenantId= as the report
export const shareSalesReportExcel = async (params) => saveAndShare(await api.get('/admin/reports/sales/export', sheetOpts(params)), 'sales-report');

/* ---------------- money: needs attention, the month, the next 30 days, notes about unpaid rent ---------------- */
export const fetchMoneyAttention = () => data(api.get('/admin/finance/attention'));
export const fetchMonth = (month) => data(api.get('/admin/finance/month', { params: month ? { month } : {} }));
export const fetchNext30 = () => data(api.get('/admin/finance/next30'));
export const shareMonthExcel = async (month) => saveAndShare(await api.get('/admin/finance/month/export', sheetOpts(month ? { month } : {})), 'month-close' + (month ? '-' + month : ''));
export const closeCollectionNote = (id, outcome) => data(api.patch('/admin/finance/notes/' + id, { outcome }));   // paid | broken | closed
