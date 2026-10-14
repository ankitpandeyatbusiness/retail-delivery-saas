import api, { data } from './adminClient';

// Other superadmins. You cannot revoke yourself: the server refuses (403) and the screen hides the button.
export const fetchTeam = () => data(api.get('/admin/team'));
export const addSuperadmin = (body) => data(api.post('/admin/team', body));            // { name?, phones: [..], email? }
export const renameSuperadmin = (id, name) => data(api.patch(`/admin/team/${id}`, { name }));
export const revokeSuperadmin = (id, body = {}) => data(api.post(`/admin/team/${id}/revoke`, body));   // { tenantId?, role? }
export const restoreSuperadmin = (id) => data(api.post(`/admin/team/${id}/restore`));
