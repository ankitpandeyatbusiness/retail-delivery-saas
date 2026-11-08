import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import api, { data } from './adminClient';

/* ---- the Export centre ---- */
export const fetchExportCatalog = () => data(api.get('/admin/exports/catalog'));
// how many rows a choice gives: { count, max, capped }
export const countExport = (key, params) => data(api.get(`/admin/exports/${key}/count`, { params }));

const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' };
const UTI = { xlsx: 'org.openxmlformats.spreadsheetml.sheet', csv: 'public.comma-separated-values-text' };
// params: { level, format: 'xlsx' | 'csv', shops?, brandId?, from?, to?, full?, ...the filters of that export }
export async function downloadExport(key, params) {
    const format = params.format === 'csv' ? 'csv' : 'xlsx';
    const res = await api.get(`/admin/exports/${key}/download`, { params: { ...params, format }, responseType: 'arraybuffer', timeout: 120000 });
    const file = new File(Paths.cache, `${key}-${Date.now()}.${format}`);
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: key, UTI: UTI[format] });
}

/* ---- saved choices ("Last month orders for my CA"): kept on this phone ---- */
const KEY = 'rc_export_presets';
export async function loadPresets() {
    try { const v = await SecureStore.getItemAsync(KEY); const list = v ? JSON.parse(v) : []; return Array.isArray(list) ? list : []; } catch (e) { return []; }
}
export async function savePresets(list) {
    try { await SecureStore.setItemAsync(KEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* the list just is not kept */ }
}

/* ---- planned maintenance ---- */
export const fetchMaintenancePlans = () => data(api.get('/admin/maintenance/plans'));
// { scope: 'all' | 'shops' | 'brand', tenantIds?, brandId?, startAt, endAt?, message?, audience?: { owners, staff, riders, customers } }
export const planMaintenance = (body) => data(api.post('/admin/maintenance/plans', body));
export const updateMaintenancePlan = (id, body) => data(api.put(`/admin/maintenance/plans/${id}`, body));   // { startAt?, endAt?, message?, audience? } while it is planned
export const cancelMaintenancePlan = (id) => data(api.post(`/admin/maintenance/plans/${id}/cancel`));
