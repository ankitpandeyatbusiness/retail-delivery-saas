import api, { data } from './adminClient';

/* ---- brands with branches (everyone looks, the supreme admin changes) ---- */
export const fetchBrands = () => data(api.get('/admin/brands'));                                         // { items }
export const createBrand = (body) => data(api.post('/admin/brands', body));                              // { name, branchLimit? }
export const fetchBrand = (id) => data(api.get(`/admin/brands/${id}`));                                  // { brand, branches, canAdd }
export const updateBrand = (id, body) => data(api.put(`/admin/brands/${id}`, body));                     // { name?, branchLimit?, notes? }
export const addBranch = (id, body) => data(api.post(`/admin/brands/${id}/branches`, body));             // { tenantId } or { name, slug, city, managerPhone?, copyFromTenantId? }
export const removeBranch = (id, tid) => data(api.delete(`/admin/brands/${id}/branches/${tid}`));
export const deleteBrand = (id) => data(api.delete(`/admin/brands/${id}`));
export const addBrandOwner = (id, phone) => data(api.post(`/admin/brands/${id}/owners`, { phone }));          // any superadmin
export const removeBrandOwner = (id, phone) => data(api.delete(`/admin/brands/${id}/owners/${phone}`));
export const fetchBrandSettings = () => data(api.get('/admin/brands/settings'));                                // { defaultDiscountPercent, maxDiscountPercent }
export const fetchBrandStatement = (id, period) => data(api.get(`/admin/brands/${id}/statement`, { params: { period } }));
export const setAreaLock = (id, tid, locked) => data(api.post(`/admin/brands/${id}/branches/${tid}/area-lock`, { locked }));   // supreme admin
