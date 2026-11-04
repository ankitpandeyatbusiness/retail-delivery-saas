import api, { data } from './adminClient';

/* "Handled by hand" marks for the Needs attention lists (Money and Orders), with the 10 minute undo. */
// kind: overdue | to_close | refund_failed | webhook_failed | unmatched | topup_uncredited | paid_no_date | sms_low | order_problem
export const markHandled = (body) => data(api.post('/admin/handled', body));                 // { kind, refId, note, title }
export const undoHandled = (id) => data(api.post(`/admin/handled/${id}/undo`));
// one Money attention list opened: { open: [...], handled: [...] }, every record with its reason
export const fetchAttentionList = (key) => data(api.get(`/admin/finance/attention/${key}`));
// the Money tab search: { total, groups: [{ key, title, items }] }
export const searchMoney = (q) => data(api.get('/admin/finance/search', { params: { q } }));

/* ---- More tab ---- */
export const fetchServerSetup = () => data(api.get('/admin/ops/setup'));
export const fetchMoreAttention = () => data(api.get('/admin/more/attention'));
// your SMS provider setup (sender, entity, key, template IDs); changing it and the test SMS are for the supreme admin
export const fetchSmsSetup = () => data(api.get('/admin/platform/sms-setup'));
export const saveSmsSetup = (body) => data(api.put('/admin/platform/sms-setup', body));
export const testSms = (phone) => data(api.post('/admin/platform/sms-setup/test', { phone }));
