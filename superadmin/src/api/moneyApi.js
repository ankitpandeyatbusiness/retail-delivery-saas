import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

const T = (shopId) => `/admin/tenants/${shopId}`;
const S = (shopId) => `${T(shopId)}/shop`;

/* ---------------- platform: your business, billing rules, SMS prices ---------------- */
export const fetchPlatform = () => data(api.get('/admin/platform'));
export const saveBusiness = (body) => data(api.put('/admin/platform/business', body));
export const saveBillingRules = (body) => data(api.put('/admin/platform/billing', body));        // { dueDays?, graceDays?, freeOrders?, freeMonths?, lateFeePercent?, lateFeeEveryDays?, overdueRemindDays? }
export const saveTiers = (tiers) => data(api.put('/admin/platform/billing/tiers', { tiers }));   // [{ upTo, fee }]  last upTo = null
export const fetchPlatformSms = () => data(api.get('/admin/platform/sms'));
export const savePlatformSms = (body) => data(api.put('/admin/platform/sms', body));
export const fetchSmsProfit = (params) => data(api.get('/admin/sms/profit', { params }));

/* ---------------- rent invoices ---------------- */
export const listInvoices = (params) => data(api.get('/admin/subscriptions/invoices', { params }));
export const getInvoice = (id) => data(api.get(`/admin/subscriptions/invoices/${id}`));
export const generateInvoices = (body) => data(api.post('/admin/subscriptions/invoices/generate', body));   // { period, tenantId? }
export const setInvoiceStatus = (id, body) => data(api.patch(`/admin/subscriptions/invoices/${id}/status`, body));
export const voidInvoice = (id, reason) => data(api.patch(`/admin/subscriptions/invoices/${id}/void`, { reason }));
export const waiveInvoice = (id, reason) => data(api.patch(`/admin/subscriptions/invoices/${id}/waive`, { reason }));
export const waiveAllLateFees = (shopId, reason) => data(api.post(`/admin/tenants/${shopId}/invoices/late-fees/waive-all`, { reason }));   // every unpaid late fee of one shop; the rent bills stay
export const extendGrace = (id, days) => data(api.patch(`/admin/subscriptions/invoices/${id}/extend-grace`, { days }));
export const resendInvoiceNotice = (id) => data(api.post(`/admin/subscriptions/invoices/${id}/resend`));

/* ---------------- one shop's billing ---------------- */
export const billingStatus = (shopId) => data(api.get(`${S(shopId)}/billing/status`));
export const billingPreview = (shopId, period) => data(api.get(`${T(shopId)}/billing/preview`, { params: period ? { period } : undefined }));
export const saveShopBilling = (shopId, body) => data(api.put(`${T(shopId)}/billing`, body));
export const endFreePeriod = (shopId) => data(api.post(`${T(shopId)}/billing/end-free`, {}));
export const goLive = (shopId, force) => data(api.post(`${T(shopId)}/billing/go-live`, force ? { force: true } : {}));
export const unpauseShop = (shopId, days) => data(api.post(`${T(shopId)}/billing/unpause`, days ? { days } : {}));
export const createCustomInvoice = (shopId, body) => data(api.post(`${T(shopId)}/invoices/custom`, body));

/* ---------------- payment gateway (Razorpay) of one shop ---------------- */
export const paymentStatus = (shopId) => data(api.get(`${T(shopId)}/payments`));
export const savePaymentKeys = (shopId, body) => data(api.put(`${T(shopId)}/payments/keys`, body));   // { keyId, keySecret, acknowledgeOpenMoney? }
export const newWebhookSecret = (shopId) => data(api.post(`${T(shopId)}/payments/webhook-secret`));
export const testPayments = (shopId) => data(api.post(`${T(shopId)}/payments/test`));
export const setPaymentsEnabled = (shopId, enabled) => data(api.put(`${T(shopId)}/payments/enabled`, { enabled }));
export const paymentReport = (shopId, params) => data(api.get(`${S(shopId)}/payments/report`, { params }));
export const listRefunds = (shopId, params) => data(api.get(`${S(shopId)}/payments/refunds`, { params }));
export const listDisputes = (shopId) => data(api.get(`${T(shopId)}/disputes`));
export const addDisputeNote = (shopId, id, text) => data(api.post(`${T(shopId)}/disputes/${id}/notes`, { text }));

/* ---------------- the ONE GST for every shop's bills ---------------- */
export const platformTax = () => data(api.get('/admin/platform/tax'));
export const savePlatformTax = (body) => data(api.put('/admin/platform/tax', body));   // { gstPercent, gstMode }

/* ---------------- who bears the cost of a cancelled order (the platform's rules) ---------------- */
export const platformMoneyRules = () => data(api.get('/admin/platform/money-rules'));   // { rules, recommended }
export const savePlatformMoneyRules = (body) => data(api.put('/admin/platform/money-rules', body));   // the rules, or { reset: true }

/* ---------------- MY Razorpay account (receives SMS top-ups and rent) ---------------- */
export const platformPaymentStatus = () => data(api.get('/admin/platform/payments'));
export const savePlatformKeys = (body) => data(api.put('/admin/platform/payments/keys', body));        // { keyId, keySecret } write only
export const newPlatformWebhookSecret = () => data(api.post('/admin/platform/payments/webhook-secret'));
export const testPlatformPayments = () => data(api.post('/admin/platform/payments/test'));

/* ---------------- SMS wallet and sender of one shop ---------------- */
export const smsWallet = (shopId) => data(api.get(`${S(shopId)}/sms/wallet`));
export const smsTransactions = (shopId, params) => data(api.get(`${S(shopId)}/sms/transactions`, { params }));
export const smsTopups = (shopId) => data(api.get(`${S(shopId)}/sms/topups`));
export const saveSmsSettings = (shopId, body) => data(api.put(`${T(shopId)}/sms/settings`, body));    // price overrides (null = platform value), blockAtZero
export const markTopupPaid = (shopId, id) => data(api.post(`${T(shopId)}/sms/topups/${id}/mark-paid`, {}));
export const smsProvider = (shopId) => data(api.get(`${T(shopId)}/sms-provider`));
export const saveSmsProvider = (shopId, body) => data(api.put(`${T(shopId)}/sms-provider`, body));

/* ---------------- ledger: every money movement ---------------- */
export const platformLedger = (params) => data(api.get('/admin/ledger', { params }));
export const shopLedger = (shopId, params) => data(api.get(`${T(shopId)}/ledger`, { params }));

// The Excel sheet is behind the login: fetch it with the token, save to cache, open the share sheet.
export async function shareLedgerExcel(shopId, params) {
    const url = shopId ? `${T(shopId)}/ledger/export` : '/admin/ledger/export';
    const res = await api.get(url, { params: { ...params, page: undefined, limit: undefined }, responseType: 'arraybuffer' });
    const file = new File(Paths.cache, `transactions-${Date.now()}.xlsx`);
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Transactions',
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
}

// A rent invoice PDF
export async function shareRentInvoicePdf(inv) {
    const res = await api.get(`/admin/subscriptions/invoices/${inv.id || inv._id}/pdf`, { responseType: 'arraybuffer' });
    const safe = String(inv.invoiceNo || 'invoice').replace(/[\/:*?"<>|]/g, '-');
    const file = new File(Paths.cache, `${safe}.pdf`);
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${inv.invoiceNo}`, UTI: 'com.adobe.pdf' });
}
