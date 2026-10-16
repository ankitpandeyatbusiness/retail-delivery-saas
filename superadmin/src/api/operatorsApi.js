import api, { data } from './adminClient';

/* ---- the companies that run the platform, and Switch operator ---- */
export const fetchOperators = () => data(api.get('/admin/operators'));                                   // { items, activeId, history }
export const fetchSwitchChecklist = (toId) => data(api.get('/admin/operators/checklist', { params: { to: toId } }));

// the supreme admin only (the server refuses everybody else)
export const saveLiveAsOperator = (label) => data(api.post('/admin/operators/from-live', { label }));
export const createOperator = (body) => data(api.post('/admin/operators', body));                      // { label, business, settlementMode, notes }
export const updateOperator = (id, body) => data(api.put(`/admin/operators/${id}`, body));
export const saveOperatorKeys = (id, body) => data(api.put(`/admin/operators/${id}/keys`, body));       // { keyId, keySecret, webhookSecret? }
export const deleteOperator = (id) => data(api.delete(`/admin/operators/${id}`));
export const switchOperator = (id, body) => data(api.post(`/admin/operators/${id}/switch`, body));      // { note, notify }
