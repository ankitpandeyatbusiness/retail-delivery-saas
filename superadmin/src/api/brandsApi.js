import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---- brands with branches (everyone looks, the supreme admin changes) ---- */
export const fetchBrands = () => data(api.get('/admin/brands'));                                         // { items }
export const createBrand = (body) => data(api.post('/admin/brands', body));                              // { name }
export const syncBrandPlan = (id) => data(api.post(`/admin/brands/${id}/sync-plan`));   // every branch follows the main shop's plan (supreme)
export const setBrandLocations = (id, body) => data(api.put(`/admin/brands/${id}/locations`, body));   // { includedBranches: n | null (platform default), freeExtra: n } supreme admin
export const fetchBrand = (id) => data(api.get(`/admin/brands/${id}`));                                  // { brand, branches, freeStart }
export const updateBrand = (id, body) => data(api.put(`/admin/brands/${id}`, body));                     // { name?, notes?, discountPercent? }
export const addBranch = (id, body) => data(api.post(`/admin/brands/${id}/branches`, body));             // { tenantId } or { name, slug, city, managerPhone?, copyFromTenantId? }
export const removeBranch = (id, tid) => data(api.delete(`/admin/brands/${id}/branches/${tid}`));
export const deleteBrand = (id) => data(api.delete(`/admin/brands/${id}`));
// move a manager, cook, waiter or rider to another branch of the brand (any superadmin): { fromTenantId, toTenantId, userId }
export const movePerson = (id, body) => data(api.post(`/admin/brands/${id}/move`, body));
export const addBrandOwner = (id, phone) => data(api.post(`/admin/brands/${id}/owners`, { phone }));          // any superadmin
export const removeBrandOwner = (id, phone) => data(api.delete(`/admin/brands/${id}/owners/${phone}`));
export const fetchBrandSettings = () => data(api.get('/admin/brands/settings'));                                // { defaultDiscountPercent, maxDiscountPercent }
export const setAreaLock = (id, tid, locked) => data(api.post(`/admin/brands/${id}/branches/${tid}/area-lock`, { locked }));   // supreme admin



// copy settings groups of one branch onto other branches (supreme admin): { fromTenantId, toTenantIds, sections }
export const pushBrandSettings = (id, body) => data(api.post(`/admin/brands/${id}/settings/push`, body));
