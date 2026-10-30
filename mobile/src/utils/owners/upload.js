// A picture for a menu record (item, category, collection...): pick it, then sign -> PUT to storage -> confirm.
// Throws an Error with `safe: true` whose message can be shown to the owner as it is.
import * as ImagePicker from 'expo-image-picker';
import { fileSize, putFile } from '../common/fileUpload';
import { signUpload, confirmUpload, signSupportPhoto, confirmSupportPhoto } from '../../api/owners/shopApi';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const fail = (m) => Object.assign(new Error(m), { safe: true });

// -> { uri, mimeType } or null when the owner backs out. square: crop to 1:1.
export async function pickImage({ square = false } = {}) {
    const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.8, exif: false,
        ...(square ? { allowsEditing: true, aspect: [1, 1] } : { allowsEditing: false }),
    });
    if (r.canceled || !r.assets?.length) return null;
    const a = r.assets[0];
    return { uri: a.uri, mimeType: ALLOWED.includes(a.mimeType) ? a.mimeType : 'image/jpeg' };
}

// several pictures at once -> [{ uri, mimeType }] (empty when the owner backs out). limit: how many he may still add.
export async function pickImages({ limit = 5 } = {}) {
    const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.8, exif: false, allowsEditing: false, allowsMultipleSelection: true, selectionLimit: Math.max(1, limit),
    });
    if (r.canceled || !r.assets?.length) return [];
    return r.assets.slice(0, Math.max(1, limit)).map((a) => ({ uri: a.uri, mimeType: ALLOWED.includes(a.mimeType) ? a.mimeType : 'image/jpeg' }));
}

// kind: product | category | collection | banner. 'product' needs refId (the item's id, or a temporary one for a new item).
// -> the saved Media { url, ... }
export async function uploadImage({ kind, uri, mimeType, refId, via }) {
    // via 'support': the picture of a help request (its own route, which stays open while the shop is paused)
    const sign = via === 'support' ? signSupportPhoto : signUpload;
    const confirm = via === 'support' ? confirmSupportPhoto : confirmUpload;
    const size = fileSize(uri);
    if (!size) throw fail('Could not read that picture');
    if (size > MAX_BYTES) throw fail('That picture is larger than 5 MB. Choose a smaller one.');
    const contentType = ALLOWED.includes(mimeType) ? mimeType : 'image/jpeg';
    const ref = refId ? { refId: String(refId) } : {};

    let signed;
    try { signed = await sign({ kind, contentType, bytes: size, ...ref }); }
    catch (e) { throw fail(e?.response?.data?.error || 'Uploads are not available right now'); }

    let sent;
    try { sent = await putFile(uri, { url: signed.uploadUrl, method: signed.method, headers: signed.headers || { 'Content-Type': contentType } }); }
    catch (e) { throw fail('Upload failed. Check the connection and try again.'); }
    if (!sent) throw fail('Upload failed. Please try again.');

    try { return await confirm({ kind, key: signed.key, ...ref }); }
    catch (e) { throw fail(e?.response?.data?.error || 'Could not save that picture'); }
}
