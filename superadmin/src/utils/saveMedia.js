// Save a picture from a conversation to the phone (or pass it on): the file is fetched into the cache and the phone's own save and share sheet opens
// (Save to device, Photos, Files, Drive ...). No extra permission needed.
import { Platform, ToastAndroid } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { toast } from '../components/feedback';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' };

// a short message that shows even above a full-screen picture (the app's own toast is drawn underneath it)
export const notify = (msg) => { if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT); else toast(msg); };

export async function savePicture(url) {
    if (!url) { notify('Nothing to save'); return; }
    try {
        if (!(await Sharing.isAvailableAsync())) { notify('Saving is not available on this phone'); return; }
        const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(String(url));
        const ext = m && MIME[m[1].toLowerCase()] ? m[1].toLowerCase() : 'jpg';
        let uri = url;
        if (/^https?:/i.test(url)) {
            notify('Getting it ready…');
            uri = (await File.downloadFileAsync(url, new File(Paths.cache, `picture-${Date.now()}.${ext}`))).uri;
        }
        await Sharing.shareAsync(uri, { mimeType: MIME[ext], dialogTitle: 'Save or share the picture' });
    } catch (e) { console.warn('[save picture]', e && e.message); notify('Could not save it'); }
}
