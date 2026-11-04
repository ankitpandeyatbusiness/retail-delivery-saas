import api, { data } from './adminClient';

/* "Handled by hand" marks for the Needs attention lists (Money and Orders), with the 10 minute undo. */
// kind: overdue | to_close | refund_failed | webhook_failed | unmatched | topup_uncredited | paid_no_date | sms_low | order_problem
export const markHandled = (body) => data(api.post('/admin/handled', body));                 // { kind, refId, note, title }
export const undoHandled = (id) => data(api.post(`/admin/handled/${id}/undo`));
// one Money attention list opened: { open: [...], handled: [...] }, every record with its reason
export const fetchAttentionList = (key) => data(api.get(`/admin/finance/attention/${key}`));
// the Money tab search: { total, groups: [{ key, title, items }] }
export const searchMoney = (q) => data(api.get('/admin/finance/search', { params: { q } }));
