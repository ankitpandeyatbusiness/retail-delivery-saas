import api, { data } from './adminClient';

/* ---- terms, agreements and the privacy policy ---- */
// everybody with a login
export const fetchLegalStatus = () => data(api.get('/admin/legal/status'));              // { required, key, version, title, body, summary }
export const acceptLegal = (key, version) => data(api.post('/admin/legal/accept', { key, version }));
export const fetchLegalMine = () => data(api.get('/admin/legal/mine'));
export const fetchAgreements = () => data(api.get('/admin/agreements'));                  // { items: [{ key, audience, title, currentVersion, publishedAt, draftChanged, stats }] }
export const fetchAgreement = (key) => data(api.get(`/admin/agreements/${key}`));          // draft, current, versions, blanks
export const fetchAgreementVersion = (key, no) => data(api.get(`/admin/agreements/${key}/versions/${no}`));
export const fetchAcceptances = (key) => data(api.get(`/admin/agreements/${key}/acceptances`));   // { version, agreed: [], waiting: [] }

// the supreme admin only
export const saveAgreementDraft = (key, body) => data(api.put(`/admin/agreements/${key}/draft`, body));       // { title, body }
export const sendAgreement = (key, body) => data(api.post(`/admin/agreements/${key}/send`, body));            // { summary, askWhen, allowBlanks }
export const setHandover = (shopId, handedOver) => data(api.post(`/admin/agreements/handover/${shopId}`, { handedOver }));
export const setLegalRole = (adminId, legalRole) => data(api.put(`/admin/legal/roles/${adminId}`, { legalRole }));
