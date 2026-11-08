// Save a picture or a voice note from a chat to the phone (or pass it on).
//   await saveMedia(url, 'image' | 'audio')
// The file is fetched into the app's cache (a picture or a voice note that was just sent is already on the phone) and the phone's own share sheet opens:
// there you choose "Save to device", Photos, Drive, Files, or any app. No extra permission is needed.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform, ToastAndroid } from 'react-native';
import { tr, tl } from '../../i18n';
import { showToast } from '../../components/customers/shop';

// a short message that shows even above a full-screen picture (the app's own toast is drawn underneath it, so it would not be seen there)
export const notify = (msg) => { if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT); else showToast(msg); };

const TYPES = {
    image: { fallbackExt: 'jpg', mime: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' }, title: tl('Save or share the picture') },
    audio: { fallbackExt: 'm4a', mime: { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', caf: 'audio/x-caf', webm: 'audio/webm' }, title: tl('Save or share the voice note') },
};

const extOf = (url, kind) => {
    const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(String(url));
    const ext = m ? m[1].toLowerCase() : '';
    return TYPES[kind].mime[ext] ? ext : TYPES[kind].fallbackExt;
};

// throws an Error with a safe message (e.safe) when it cannot be done
export async function saveMedia(url, kind = 'image') {
    const t = TYPES[kind];
    const fail = (m) => Object.assign(new Error(m), { safe: true });   // m is already translated: write it as fail(tr('...')) so the translation tools find it
    if (!url || !t) throw fail(tr('Nothing to save'));
    if (!(await Sharing.isAvailableAsync())) throw fail(tr('Saving is not available on this phone'));
    const ext = extOf(url, kind);
    let uri = url;
    if (/^https?:/i.test(url)) {
        notify(tr('Getting it ready…'));   // the download takes a moment: say that something is happening
        try {
            const dest = new File(Paths.cache, `chat-${kind}-${Date.now()}.${ext}`);
            uri = (await File.downloadFileAsync(url, dest)).uri;
        } catch (e) { throw fail(tr('Could not download it. Check your internet and try again.')); }
    }
    await Sharing.shareAsync(uri, { mimeType: t.mime[ext], dialogTitle: tr(t.title) });
}
