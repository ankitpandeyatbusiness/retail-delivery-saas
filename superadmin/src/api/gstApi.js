import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { data } from './adminClient';

/* ---- GST register: every bill, SMS top-up invoice and credit note of a month ---- */
export const fetchGstRegister = (month) => data(api.get('/admin/platform/gst-register', { params: { month } }));

export async function shareGstRegister(month) {
    const res = await api.get('/admin/platform/gst-register', { params: { month, format: 'xlsx' }, responseType: 'arraybuffer' });
    const file = new File(Paths.cache, `gst-register-${month}.xlsx`);
    file.create();
    file.write(new Uint8Array(res.data));
    if (!(await Sharing.isAvailableAsync())) throw Object.assign(new Error('Sharing is not available on this phone'), { safe: true });
    await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: `GST register ${month}`,
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
}
