import api, { data } from './adminClient';

// Menu, collections, banners and coupons. They go through the shop's own routes (/shop/...), which the superadmin
// may use for any shop: that includes category timings and stock, which the plain admin routes do not have.
const base = (shopId, resource) => `/admin/tenants/${shopId}/shop/${resource}`;

// resource: categories | products | collections | banners | coupons
export const listRecords = (shopId, resource, params) => data(api.get(base(shopId, resource), { params }));
export const getRecord = (shopId, resource, id) => data(api.get(`${base(shopId, resource)}/${id}`));
export const createRecord = (shopId, resource, body) => data(api.post(base(shopId, resource), body));
export const updateRecord = (shopId, resource, id, body) => data(api.patch(`${base(shopId, resource)}/${id}`, body));
export const removeRecord = (shopId, resource, id) => data(api.delete(`${base(shopId, resource)}/${id}`));

// stock of one product: { enabled?, qty? }
export const setStock = (shopId, productId, body) => data(api.patch(`${base(shopId, 'products')}/${productId}/stock`, body));

// CSV import: rows -> preview (nothing saved) or real save
export const importPreview = (shopId, rows) => data(api.post(`/admin/tenants/${shopId}/products/import`, { rows }, { params: { dryRun: 'true' } }));
export const importSave = (shopId, rows) => data(api.post(`/admin/tenants/${shopId}/products/import`, { rows }, { params: { dryRun: 'false' } }));

// what the customer app hides because there is no data yet, and why
export const fetchAvailability = (shopId) => data(api.get(`/admin/tenants/${shopId}/availability`));
