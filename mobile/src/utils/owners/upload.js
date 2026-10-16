// A picture for a menu record (item, category, collection...): pick it, then sign -> PUT to storage -> confirm.
// Throws an Error with `safe: true` whose message can be shown to the owner as it is.
import * as ImagePicker from 'expo-image-picker';
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

// kind: product | category | collection | banner. 'product' needs refId (the item's id, or a temporary one for a new item).
// -> the saved Media { url, ... }
export async function uploadImage({ kind, uri, mimeType, refId, via }) {
    // via 'support': the picture of a help request (its own route, which stays open while the shop is paused)
    const sign = via === 'support' ? signSupportPhoto : signUpload;
    const confirm = via === 'support' ? confirmSupportPhoto : confirmUpload;
    let blob;
    try { blob = await (await fetch(uri)).blob(); } catch (e) { throw fail('Could not read that picture'); }
    if (!blob.size) throw fail('That picture is empty');
    if (blob.size > MAX_BYTES) throw fail('That picture is larger than 5 MB. Choose a smaller one.');
    const contentType = ALLOWED.includes(mimeType) ? mimeType : 'image/jpeg';
    const ref = refId ? { refId: String(refId) } : {};

    let signed;
    try { signed = await sign({ kind, contentType, bytes: blob.size, ...ref }); }
    catch (e) { throw fail(e?.response?.data?.error || 'Uploads are not available right now'); }

    let put;
    try { put = await fetch(signed.uploadUrl, { method: signed.method || 'PUT', headers: signed.headers || { 'Content-Type': contentType }, body: blob }); }
    catch (e) { throw fail('Upload failed. Check the connection and try again.'); }
    if (!put.ok) throw fail('Upload failed. Please try again.');

    try { return await confirm({ kind, key: signed.key, ...ref }); }
    catch (e) { throw fail(e?.response?.data?.error || 'Could not save that picture'); }
}
