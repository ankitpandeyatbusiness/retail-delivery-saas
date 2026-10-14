// A rider's own picture, and the photo of the food handed over (proof of a safe delivery).
//   1. ask the server for a short-lived storage address   2. PUT the file there   3. tell the server it is done
// Every function throws an Error with `safe: true` and a sentence that can be shown to the rider as it is.
import { pickPhoto } from '../common/photoUpload';
import { signMyPhoto, confirmMyPhoto, deleteMyPhoto, signProof, confirmProof } from '../../api/riders/riderApi';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const fail = (m) => Object.assign(new Error(m), { safe: true });

async function putFile({ uri, mimeType }, sign) {
    let blob;
    try { blob = await (await fetch(uri)).blob(); } catch (e) { throw fail('Could not read that photo'); }
    if (!blob.size) throw fail('That photo is empty');
    if (blob.size > MAX_BYTES) throw fail('That photo is too large (max 5 MB). Try again.');
    const contentType = ALLOWED.includes(mimeType) ? mimeType : 'image/jpeg';

    let signed;
    try { signed = await sign({ contentType, bytes: blob.size }); } catch (e) {
        throw fail(e?.response?.data?.error || 'Photo upload is not available right now');
    }
    let put;
    try {
        put = await fetch(signed.uploadUrl, { method: signed.method || 'PUT', headers: signed.headers || { 'Content-Type': contentType }, body: blob });
    } catch (e) { throw fail('Upload failed. Check your connection and try again.'); }
    if (!put.ok) throw fail('Upload failed. Please try again.');
    return signed.key;
}

// source: 'camera' | 'gallery'. -> { photo } or null when the rider backs out
export async function takeAndUploadMyPhoto(source) {
    const picked = await pickPhoto(source, { square: true });
    if (!picked) return null;
    const key = await putFile(picked, signMyPhoto);
    try {
        const r = await confirmMyPhoto(key);
        return { photo: r.photo };
    } catch (e) { throw fail(e?.response?.data?.error || 'Could not save that photo'); }
}

export const removeMyPhoto = () => deleteMyPhoto();

// the camera only: a proof must be taken at the door. -> { proof: { url, at } } or null
export async function takeAndUploadProof(orderId) {
    const picked = await pickPhoto('camera');
    if (!picked) return null;
    const key = await putFile(picked, (b) => signProof(orderId, b));
    try {
        return await confirmProof(orderId, key);
    } catch (e) { throw fail(e?.response?.data?.error || 'Could not save that photo'); }
}
