import api, { data } from './adminClient';

/* ---- the terms, privacy policies and About Us texts (backend/src/routes/adminLegalPagesRouter.js) ---- */
export const fetchLegalPages = () => data(api.get('/admin/legal-pages'));                                     // { items: [{ key, title, audience, currentNo, publishedAt, publishedBy, hasDraft, versions }] }
export const fetchLegalPage = (key) => data(api.get(`/admin/legal-pages/${key}`));                            // { draft, current, versions, names, blanks, preview, builtIn }
export const fetchLegalPageVersion = (key, no) => data(api.get(`/admin/legal-pages/${key}/versions/${no}`));  // an old text
export const saveLegalDraft = (key, body) => data(api.put(`/admin/legal-pages/${key}/draft`, body));          // { title, body }  (supreme admin)
export const discardLegalDraft = (key) => data(api.post(`/admin/legal-pages/${key}/discard`));                // (supreme admin)
export const publishLegalPage = (key) => data(api.post(`/admin/legal-pages/${key}/publish`));                 // (supreme admin) everybody sees it at once
export const restoreLegalVersion = (key, no) => data(api.post(`/admin/legal-pages/${key}/restore/${no}`));    // (supreme admin) an old text becomes the draft
