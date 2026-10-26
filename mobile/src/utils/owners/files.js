// Download a file from the shop's API (PDF, Excel) and open it: a PDF in the phone's viewer, anything else through the
// share sheet (Excel -> Sheets, Drive, WhatsApp...). Throws an Error with `safe: true` whose message can be shown.
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import api from '../../api/common/client';

const fail = (m) => Object.assign(new Error(m), { safe: true });
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function downloadAndOpen({ path, params, filename, mime, title }) {
    let res;
    try { res = await api.get(path, { params, responseType: 'arraybuffer' }); }
    catch (e) {
        let msg = 'Could not download the file';
        try { msg = JSON.parse(String.fromCharCode(...new Uint8Array(e.response.data).slice(0, 400))).error || msg; } catch (x) { /* not json */ }
        throw fail(msg);
    }
    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(res.data));
    if (Platform.OS === 'android' && mime === 'application/pdf') {
        try { await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: mime, flags: 1 }); return; }
        catch (e) { /* no viewer: share it instead */ }
    }
    if (!(await Sharing.isAvailableAsync())) throw fail('No app on this phone can open this file');
    await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: title || filename, ...(mime === XLSX ? { UTI: 'org.openxmlformats.spreadsheetml.sheet' } : {}) });
}
