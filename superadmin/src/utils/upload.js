// Pick a picture and upload it for a shop: sign -> PUT the file to storage -> confirm.
// Throws an Error whose message can be shown as it is.
import * as ImagePicker from 'expo-image-picker';
import { signUpload, confirmUpload } from '../api/shopsApi';
import { signMyPhoto, confirmMyPhoto } from '../api/authApi';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const fail = (m) => Object.assign(new Error(m), { safe: true });

// -> { uri, mimeType } or null when the person backs out. square: crop to 1:1 (icons).
export async function pickImage({ square = false } = {}) {
    const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.85, exif: false,
        ...(square ? { allowsEditing: true, aspect: [1, 1] } : { allowsEditing: false }),
    });
    if (r.canceled || !r.assets?.length) return null;
    const a = r.assets[0];
    return { uri: a.uri, mimeType: ALLOWED.includes(a.mimeType) ? a.mimeType : 'image/jpeg' };
}

// kind: logo | hero | icon | adaptive | splash ... (see backend mediaService). -> the saved Media { _id, url, ... }
export async function uploadImage(shopId, { kind, uri, mimeType, refId }) {
    let blob;
    try { blob = await (await fetch(uri)).blob(); } catch (e) { throw fail('Could not read that picture'); }
    if (!blob.size) throw fail('That picture is empty');
    if (blob.size > MAX_BYTES) throw fail('That picture is larger than 5 MB. Choose a smaller one.');
    const contentType = ALLOWED.includes(mimeType) ? mimeType : 'image/jpeg';

    let signed;
    try {
        signed = await signUpload(shopId, { kind, contentType, bytes: blob.size, ...(refId ? { refId } : {}) });
    } catch (e) {
        throw fail(e?.response?.data?.error || 'Uploads are not available right now');
    }
    let put;
    try {
        put = await fetch(signed.uploadUrl, { method: signed.method || 'PUT', headers: signed.headers || { 'Content-Type': contentType }, body: blob });
    } catch (e) { throw fail('Upload failed. Check the connection and try again.'); }
    if (!put.ok) throw fail('Upload failed. Please try again.');
    try {
        return await confirmUpload(shopId, { kind, key: signed.key, ...(refId ? { refId } : {}) });
    } catch (e) {
        throw fail(e?.response?.data?.error || 'Could not save that picture');
    }
}

// the superadmin's own picture -> the saved public URL
export async function uploadMyPhoto({ uri, mimeType }) {
    let blob;
    try { blob = await (await fetch(uri)).blob(); } catch (e) { throw fail('Could not read that picture'); }
    if (!blob.size) throw fail('That picture is empty');
    if (blob.size > MAX_BYTES) throw fail('That picture is larger than 5 MB. Choose a smaller one.');
    const contentType = ALLOWED.includes(mimeType) ? mimeType : 'image/jpeg';
    let signed;
    try { signed = await signMyPhoto({ contentType, bytes: blob.size }); } catch (e) { throw fail(e?.response?.data?.error || 'Uploads are not available right now'); }
    let put;
    try { put = await fetch(signed.uploadUrl, { method: signed.method || 'PUT', headers: signed.headers || { 'Content-Type': contentType }, body: blob }); } catch (e) { throw fail('Upload failed. Check the connection and try again.'); }
    if (!put.ok) throw fail('Upload failed. Please try again.');
    try { return (await confirmMyPhoto(signed.key)).photo; } catch (e) { throw fail(e?.response?.data?.error || 'Could not save that picture'); }
}
