import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---- QR codes for printing: the public demo and a shop's tables (SVG and PDF are vector, PNG at a size and DPI) ---- */
export const fetchQrInfo = () => data(api.get('/admin/qr/info'));        // { base, permanent, warning, demo: { link, destination } }

const MIME = { svg: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf' };
const UTI = { svg: 'public.svg-image', png: 'public.png', pdf: 'com.adobe.pdf' };

// the picture of the demo code for the preview on the screen (SVG text)
export async function fetchDemoPreview() {
    const res = await api.get('/admin/qr/demo', { params: { format: 'svg' }, responseType: 'text', transformResponse: (d) => d });
    return String(res.data);
}

// path: '/admin/qr/demo' or '/admin/qr/tables/<tenantId>'; params: { format, sizePx, dpi, sizeMm, table, logo }
export async function downloadQr(path, params, name) {
    const format = ['svg', 'png', 'pdf'].includes(params.format) ? params.format : 'png';
    const res = await api.get(path, { params: { ...params, format }, responseType: 'arraybuffer', timeout: 120000 });
    const file = new File(Paths.cache, `${name}-${Date.now()}.${format}`);
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: name, UTI: UTI[format] });
}
