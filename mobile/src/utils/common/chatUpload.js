// A picture or a voice note for a chat: sign -> PUT to storage -> confirm, the same three steps as every upload. The customer and the owner have their own
// sign and confirm routes; `role` says which. Returns the stored file's address. Errors carry `safe: true` and a message that can be shown as it is.
import { fileSize, putFile } from './fileUpload';
import * as customerApi from '../../api/customers/shopApi';
import * as ownerApi from '../../api/owners/shopApi';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const fail = (m) => Object.assign(new Error(m), { safe: true });

async function uploadFile({ role, kind, uri, contentType, maxBytes, tooBig }) {
    const api = role === 'admin' ? ownerApi : customerApi;
    const size = await fileSize(uri);
    if (!size) throw fail('Could not read that file');
    if (size > maxBytes) throw fail(tooBig);
    let signed;
    try { signed = await api.signUpload({ kind, contentType, bytes: size }); } catch (e) { throw fail(e?.response?.data?.error || 'Uploads are not available right now'); }
    let sent;
    try { sent = await putFile(uri, { url: signed.uploadUrl, method: signed.method, headers: signed.headers || { 'Content-Type': contentType } }, {}); } catch (e) { throw fail('Upload failed. Check the connection and try again.'); }
    if (!sent) throw fail('Upload stopped');
    try { const media = await api.confirmUpload({ kind, key: signed.key }); return media.url; } catch (e) { throw fail(e?.response?.data?.error || 'Could not save that file'); }
}

export const uploadChatPhoto = ({ role, uri, mimeType }) => uploadFile({
    role, kind: 'chat', uri, contentType: PHOTO_TYPES.includes(mimeType) ? mimeType : 'image/jpeg', maxBytes: 5 * 1024 * 1024, tooBig: 'That photo is too large (max 5 MB). Try another one.',
});
export const uploadChatVoice = ({ role, uri }) => uploadFile({
    role, kind: 'chatvoice', uri, contentType: 'audio/mp4', maxBytes: 1.5 * 1024 * 1024, tooBig: 'That voice note is too long. Keep it under 2 minutes.',
});
