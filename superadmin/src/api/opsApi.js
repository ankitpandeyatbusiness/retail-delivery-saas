import api, { data } from './adminClient';

const S = (shopId) => `/admin/tenants/${shopId}/shop`;

/* ---- riders ---- */
export const listRiders = (shopId) => data(api.get(`${S(shopId)}/riders`));
export const addRider = (shopId, body) => data(api.post(`${S(shopId)}/riders`, body));                       // { phone, name? }
export const updateRider = (shopId, userId, body) => data(api.patch(`${S(shopId)}/riders/${userId}`, body)); // { isActive?, name?, email? }
export const removeRider = (shopId, userId) => data(api.delete(`${S(shopId)}/riders/${userId}`));
export const riderLocations = (shopId) => data(api.get(`${S(shopId)}/riders/locations`));

/* ---- cash on delivery held by riders, and performance ---- */
export const codBalances = (shopId) => data(api.get(`${S(shopId)}/cod/riders`));
export const codLedger = (shopId, userId, params) => data(api.get(`${S(shopId)}/cod/riders/${userId}/ledger`, { params }));
export const codHandover = (shopId, userId, body) => data(api.post(`${S(shopId)}/cod/riders/${userId}/handover`, body));   // { amountPaise, note? }
export const codAdjust = (shopId, userId, body) => data(api.post(`${S(shopId)}/cod/riders/${userId}/adjust`, body));       // { amountPaise (+/-), note }
export const riderPerformance = (shopId, params) => data(api.get(`${S(shopId)}/cod/performance`, { params }));              // { from, to } YYYY-MM-DD

/* ---- complaints ---- */
export const listShopComplaints = (shopId, params) => data(api.get(`${S(shopId)}/complaints`, { params }));
export const listAllComplaints = (params) => data(api.get('/admin/complaints', { params }));
// body { ownerReply?, resolution?: refund_full | refund_partial | no_refund, refundPaise? }
export const decideComplaint = (shopId, id, body) => data(api.patch(`${S(shopId)}/complaints/${id}`, body));

/* ---- messages to a shop's customers and riders ---- */
export const listShopMessages = (shopId) => data(api.get(`${S(shopId)}/messages`));
export const getShopMessage = (shopId, id) => data(api.get(`${S(shopId)}/messages/${id}`));
export const sendShopMessage = (shopId, body) => data(api.post(`${S(shopId)}/messages`, body));   // { title, body, kind, audience, sendEmail }

/* ---- activity log of the shop ---- */
export const listActivity = (shopId, params) => data(api.get(`${S(shopId)}/activity`, { params }));

/* ---- customers: allow cash on delivery again ---- */
export const allowCod = (shopId, userId) => data(api.patch(`${S(shopId)}/customers/${userId}/cod-block`, { blocked: false }));
