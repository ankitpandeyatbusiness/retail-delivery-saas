// Pick a photo (camera or gallery) and upload it: a complaint photo for one order, or the customer's profile picture.
//   1. POST /me/uploads/sign     -> a short-lived storage URL
//   2. PUT the file to that URL  (same Content-Type, exact size)
//   3. POST /me/uploads/confirm  -> { url, _id } of the stored photo
// pickPhoto and the upload functions throw an Error with `safe: true` and a message that can be shown to the customer.
import * as ImagePicker from 'expo-image-picker';
import { signUpload, confirmUpload, deleteUpload } from '../api/shopApi';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

const fail = (message) => Object.assign(new Error(message), { safe: true });

// source: 'camera' | 'gallery'. { square: true } lets the customer crop to a square (profile picture).
// Resolves to { uri, mimeType } or null when the customer backs out.
export async function pickPhoto(source, { square = false } = {}) {
    if (source === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) throw fail('Allow camera access in settings to take a photo');
    }
    const opts = {
        mediaTypes: ['images'], quality: 0.6, exif: false,
        ...(square ? { allowsEditing: true, aspect: [1, 1] } : { allowsEditing: false }),
    };
    const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.length) return null;
    const a = r.assets[0];
    return { uri: a.uri, mimeType: ALLOWED.includes(a.mimeType) ? a.mimeType : 'image/jpeg' };
}

// kind 'complaint' needs refId (the order id). kind 'customer' (profile picture) needs none.
async function upload({ kind, refId, uri, mimeType }) {
    let blob;
    try { blob = await (await fetch(uri)).blob(); } catch (e) { throw fail('Could not read that photo'); }
    if (!blob.size) throw fail('That photo is empty');
    if (blob.size > MAX_BYTES) throw fail('That photo is too large (max 5 MB). Try another one.');

    const contentType = ALLOWED.includes(mimeType) ? mimeType : 'image/jpeg';
    const ref = refId ? { refId: String(refId) } : {};

    let signed;
    try {
        signed = await signUpload({ kind, ...ref, contentType, bytes: blob.size });
    } catch (e) {
        throw fail(e?.response?.data?.error || 'Photo upload is not available right now');
    }

    let put;
    try {
        put = await fetch(signed.uploadUrl, { method: signed.method || 'PUT', headers: signed.headers || { 'Content-Type': contentType }, body: blob });
    } catch (e) { throw fail('Upload failed. Check your connection and try again.'); }
    if (!put.ok) throw fail('Upload failed. Please try again.');

    try {
        const m = await confirmUpload({ kind, ...ref, key: signed.key });
        return { id: m._id || m.id, url: m.url };
    } catch (e) {
        throw fail(e?.response?.data?.error || 'Could not save that photo');
    }
}

// -> { id, url }
export const uploadComplaintPhoto = ({ orderId, uri, mimeType }) => upload({ kind: 'complaint', refId: orderId, uri, mimeType });

// Replaces the previous profile picture (the server keeps one file per customer). -> { id, url }
export const uploadAvatar = ({ uri, mimeType }) => upload({ kind: 'customer', uri, mimeType });

// best effort: removing a photo that was not sent must not bother the customer
export const discardPhoto = (id) => (id ? deleteUpload(id).catch(() => { }) : Promise.resolve());
