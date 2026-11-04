import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---- brands with branches (everyone looks, the supreme admin changes) ---- */
export const fetchBrands = () => data(api.get('/admin/brands'));                                         // { items }
export const createBrand = (body) => data(api.post('/admin/brands', body));                              // { name }
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
export const fetchBrandStatement = (id, period) => data(api.get(`/admin/brands/${id}/statement`, { params: { period } }));
export const setAreaLock = (id, tid, locked) => data(api.post(`/admin/brands/${id}/branches/${tid}/area-lock`, { locked }));   // supreme admin

// the brand's monthly statement as a PDF, shared through the phone's share sheet
export async function shareBrandStatementPdf(brand, period) {
    const res = await api.get(`/admin/brands/${brand._id}/statement.pdf`, { params: { period }, responseType: 'arraybuffer' });
    const safe = String(brand.name || 'brand').replace(/[^A-Za-z0-9_-]+/g, '-');
    const file = new File(Paths.cache, `Statement-${safe}-${period}.pdf`);
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `Statement ${brand.name} ${period}`, UTI: 'com.adobe.pdf' });
}
export const setFreeStart = (id, body) => data(api.put(`/admin/brands/${id}/free-start`, body));   // supreme admin: { on, freeOrders?, freeMonths? }

// the supreme admin's bulk money actions: tenantIds is 'all' or a list of branch ids. Each answers { rows: [{ slug, name, done, amount, skipped: [{ invoiceNo, reason }] }], totals }
export const bulkWaiveLateFees = (id, tenantIds, reason) => data(api.post(`/admin/brands/${id}/bulk/waive-late-fees`, { tenantIds, reason }));
export const bulkMarkPaid = (id, body) => data(api.post(`/admin/brands/${id}/bulk/mark-paid`, body));          // { tenantIds, paymentMode?, paymentRef?, receivedBy, note? }
export const bulkMarkUnpaid = (id, body) => data(api.post(`/admin/brands/${id}/bulk/mark-unpaid`, body));      // { tenantIds, period }

// copy settings groups of one branch onto other branches (supreme admin): { fromTenantId, toTenantIds, sections }
export const pushBrandSettings = (id, body) => data(api.post(`/admin/brands/${id}/settings/push`, body));
