import api, { data } from './adminClient';

/* ---- inbox (alerts for the superadmin) ---- */
export const fetchInbox = (params) => data(api.get('/admin/notifications', { params }));          // { unread: 'true', page, limit }
export const readAllInbox = () => data(api.post('/admin/notifications/read-all'));
export const readInbox = (id) => data(api.post(`/admin/notifications/${id}/read`));
export const clearInbox = () => data(api.delete('/admin/notifications'));
export const deleteInboxItem = (id) => data(api.delete(`/admin/notifications/${id}`));

/* ---- messages to the owners of shops ---- */
export const listOwnerMessages = () => data(api.get('/admin/messages'));
export const getOwnerMessage = (id) => data(api.get(`/admin/messages/${id}`));
export const sendOwnerMessage = (body) => data(api.post('/admin/messages', body));                 // { title, body, tenantIds?, sendEmail? }

/* ---- platform-wide switches ---- */
export const fetchPlatform = () => data(api.get('/admin/platform'));
export const saveMaintenance = (body) => data(api.put('/admin/platform/maintenance', body));       // { on, message?, until? }
export const saveAlerts = (body) => data(api.put('/admin/platform/alerts', body));                 // { smsToAdmin?, allEvents?, phone? }
export const alertSmsCost = (params) => data(api.get('/admin/alerts/sms-cost', { params }));

/* ---- how each event is delivered ---- */
export const fetchRules = () => data(api.get('/admin/notification-rules'));
export const saveRule = (body) => data(api.put('/admin/notification-rules', body));                // { eventKey, tenantId?, enabled?, channels?, alsoPush?, escalateSmsAfterSec?, reset? }

/* ---- audit log ---- */
export const listAudit = (params) => data(api.get('/admin/audit-logs', { params }));

/* ---- my account ---- */
export const changeMyPhones = (body) => data(api.put('/admin/me/phones', body));                   // { phones, verifyPhone, otp }

/* ---- live tracking of riders: how the server is doing, and the switch (the supreme admin changes it) ---- */
export const fetchTracking = () => data(api.get('/admin/platform/tracking'));
export const saveTracking = (body) => data(api.put('/admin/platform/tracking', body));            // { mode?, maxSockets?, pollSec?, routeCap? } or { reset: true }

/* ---- alert devices (push) ---- */
export const registerDevice = (body) => data(api.post('/admin/devices', body));                    // { token, platform }
export const removeDevice = (token) => data(api.post('/admin/devices/remove', { token }));
