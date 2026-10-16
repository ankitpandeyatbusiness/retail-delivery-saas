import api, { data } from './adminClient';

/* ---- help & support requests from shop owners ---- */
export const fetchSupportList = (params) => data(api.get('/admin/support', { params }));              // { status: open|answered|resolved|all, q, tenantId, page } -> { items, counts, page, hasMore }
export const fetchSupportCounts = () => data(api.get('/admin/support/counts'));                       // { open, answered, resolved, unread }
export const fetchSupportOne = (id) => data(api.get(`/admin/support/${id}`));                         // the conversation with private notes, the shop and the owner
export const replySupportOne = (id, body) => data(api.post(`/admin/support/${id}/reply`, body));      // { message, photos?, resolve? }
export const noteSupportOne = (id, body) => data(api.post(`/admin/support/${id}/note`, body));        // { message }  private to the team
export const setSupportOne = (id, body) => data(api.patch(`/admin/support/${id}`, body));             // { status?, priority? }
export const fetchSupportSettings = () => data(api.get('/admin/support/settings'));                   // the contact card owners see
export const saveSupportSettings = (body) => data(api.put('/admin/support/settings', body));          // { phone?, whatsapp?, email?, hours?, replyPromise? }
