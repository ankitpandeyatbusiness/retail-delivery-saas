import api, { data } from './adminClient';

const T = (id) => `/admin/tenants/${id}`;

export const fetchShops = (q) => data(api.get('/admin/tenants', { params: q ? { q } : undefined }));
export const fetchShop = (id) => data(api.get(T(id)));
export const createShop = (body) => data(api.post('/admin/tenants', body));
export const updateShop = (id, body) => data(api.put(T(id), body));
// everything a developer needs to know about one shop's app (read only), plus the developer's own notes
export const fetchDevDetails = (id) => data(api.get(`${T(id)}/dev-details`));
export const saveDevNotes = (id, notes) => data(api.put(`${T(id)}/dev-notes`, { notes }));
export const fetchPoints = (id) => data(api.get(`${T(id)}/loyalty`));
export const savePoints = (id, body) => data(api.put(`${T(id)}/loyalty`, body));
export const fetchOptions = () => data(api.get('/admin/options'));

export const fetchLive = (id) => data(api.get(`${T(id)}/live`));
// closing a shop (everything kept) and opening it again; the shops whose rent is unpaid for months
export const fetchClosure = (id) => data(api.get(`${T(id)}/closure`));
export const closeShop = (id, body) => data(api.post(`${T(id)}/close`, body));
export const reopenShop = (id, body) => data(api.post(`${T(id)}/reopen`, body));
export const fetchToClose = () => data(api.get('/admin/finance/to-close'));
export const setOwnerAccess = (id, blocked, reason) => data(api.put(`${T(id)}/owner-access`, { blocked, reason }));
export const setMaintenance = (id, body) => data(api.put(`${T(id)}/maintenance`, body));
export const notifyShop = (id, body) => data(api.post(`${T(id)}/notify`, body));

export const fetchUsers = (id, params) => data(api.get(`${T(id)}/users`, { params }));
export const fetchUser = (id, userId) => data(api.get(`${T(id)}/users/${userId}`));
export const updateUser = (id, userId, body) => data(api.patch(`${T(id)}/users/${userId}`, body));
export const blockUser = (id, userId, blocked) => data(api.patch(`${T(id)}/users/${userId}/block`, { blocked }));
export const revealPhone = (id, userId) => data(api.get(`${T(id)}/users/${userId}/phone`));
export const changeUserPhone = (id, userId, phone, reason) => data(api.patch(`${T(id)}/users/${userId}/phone`, { phone, reason }));

export const fetchOwners = (id) => data(api.get(`${T(id)}/owners`));
export const addOwner = (id, phone) => data(api.post(`${T(id)}/owners`, { phone }));
export const removeOwner = (id, userId) => data(api.delete(`${T(id)}/owners/${userId}`));

// Move a person between customer, rider and owner ("admin") inside this shop. They are logged out so the app reopens in the new mode.
export const changeUserRole = (id, userId, role) => data(api.patch(`${T(id)}/users/${userId}/role`, { role }));

/* ---- customer-app settings and branding ---- */
// What the app WOULD receive for a draft. Nothing is saved. -> { config, errors }
export const previewConfig = (body) => data(api.post('/admin/preview-config', body));

// images of a shop (hero, logo, icon...). Items have ids, which delete and reorder need.
export const listMedia = (id, kind) => data(api.get(`${T(id)}/media`, { params: kind ? { kind } : undefined }));
// uploads: sign -> PUT the file to uploadUrl -> confirm
export const signUpload = (id, body) => data(api.post(`${T(id)}/shop/uploads/sign`, body));
export const confirmUpload = (id, body) => data(api.post(`${T(id)}/shop/uploads/confirm`, body));
export const deleteMedia = (id, mediaId) => data(api.delete(`${T(id)}/shop/uploads/${mediaId}`));
export const reorderHeroes = (id, ids) => data(api.put(`${T(id)}/shop/uploads/hero-order`, { ids }));

// Colours worked out from the shop's logo. The logo is sent as the raw request body.
// apply: undefined = only suggest, 'empty' = fill colours that are not set, 'replace' = overwrite
import { baseURL } from './adminClient';
import { useAuthStore } from '../store/useAuthStore';
export async function logoColors(id, logoUrl, apply) {
    const img = await fetch(logoUrl);
    const blob = await img.blob();
    const type = ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ? blob.type : 'image/png';
    const res = await fetch(`${baseURL}/admin/tenants/${id}/logo-colors${apply ? `?apply=${apply}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': type, Authorization: `Bearer ${useAuthStore.getState().token}`, 'ngrok-skip-browser-warning': 'true' },
        body: blob,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || 'Could not read the logo colours'), { safe: true });
    return json;
}

// Colours of a logo picture on this phone, before any shop exists (used by the new-shop wizard). Saves nothing.
export async function previewLogoColors(uri) {
    const blob = await (await fetch(uri)).blob();
    const type = ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ? blob.type : 'image/png';
    const res = await fetch(`${baseURL}/admin/logo-colors`, {
        method: 'POST',
        headers: { 'Content-Type': type, Authorization: `Bearer ${useAuthStore.getState().token}`, 'ngrok-skip-browser-warning': 'true' },
        body: blob,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.error || 'Could not read the logo colours'), { safe: true });
    return json;
}

/* ---- map: place search and the address of a point ---- */
export const searchPlaces = (q, near) => data(api.get('/admin/geo/search', { params: { q, ...(near ? { lat: near.latitude, lng: near.longitude } : {}) } }));
export const placePoint = (id) => data(api.get('/admin/geo/place', { params: { id } }));
export const reversePlace = (lat, lng) => data(api.get('/admin/geo/reverse', { params: { lat, lng } }));

// Plans (Partner / Growth / Pro). Changes are for the supreme admin only; the server refuses everybody else.
export const fetchPlanCatalog = () => data(api.get('/admin/plans'));
export const fetchShopPlan = (id) => data(api.get(`${T(id)}/plan`));
export const setShopPlan = (id, body) => data(api.put(`${T(id)}/plan`, body));
export const setShopPlanExtra = (id, key, on) => data(api.put(`${T(id)}/plan/extras`, { key, on }));
export const setShopPlanTerms = (id, body) => data(api.put(`${T(id)}/plan/terms`, body));
// how a shop looks on a plan (shopId empty: the plain plan, used by the new-shop wizard)
export const fetchPlanPreview = (shopId, plan, freeDays) => (shopId
    ? data(api.get(`${T(shopId)}/plan/preview`, { params: { plan, ...(freeDays !== undefined ? { freeDays } : {}) } }))
    : data(api.get('/admin/plans/preview', { params: { plan, ...(freeDays !== undefined ? { freeDays } : {}) } })));
// phase 9: move every existing shop onto Pro, free for 30 days (the preview is a dry run)
export const fetchPlanMigration = () => data(api.get('/admin/plans/migration/preview'));
export const runPlanMigration = (confirm) => data(api.post('/admin/plans/migration/run', { confirm }));
export const rollbackPlanMigration = (confirm) => data(api.post('/admin/plans/migration/rollback', { confirm }));
export const fetchShopWallet = (id) => data(api.get(`${T(id)}/wallet`));
export const adjustShopWallet = (id, body) => data(api.post(`${T(id)}/wallet/adjust`, body));
export const savePlanDefaults = (body) => data(api.put('/admin/platform/plans', body));
