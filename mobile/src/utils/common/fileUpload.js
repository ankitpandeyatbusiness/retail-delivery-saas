// Sending a picked picture to storage straight from the file, without turning it into a Blob first
// (a Blob copies the whole picture through the native side, which is slow and warns).
import { File, UploadType } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';

// size of the picked file in bytes (0 when it cannot be read)
export function fileSize(uri) {
    try { return new File(uri).size || 0; } catch (e) { return 0; }
}

// PUT the file to a signed storage URL. true when storage accepted it.
// opts.onProgress(0..1): how much has gone (the round loader on a picture); opts.handle: gets .cancel() to stop the upload half way.
export async function putFile(uri, { url, method, headers }, opts = {}) {
    if (opts.onProgress || opts.handle) {
        try {
            const task = Legacy.createUploadTask(url, uri, { httpMethod: method === 'POST' ? 'POST' : 'PUT', uploadType: Legacy.FileSystemUploadType.BINARY_CONTENT, headers },
                (p) => { if (p?.totalBytesExpectedToSend > 0) opts.onProgress?.(Math.min(1, p.totalBytesSent / p.totalBytesExpectedToSend)); });
            if (opts.handle) opts.handle.cancel = () => { opts.handle.stopped = true; task.cancelAsync().catch(() => { }); };
            const r = await task.uploadAsync();
            if (opts.handle?.stopped) return false;
            return !!r && r.status >= 200 && r.status < 300;
        } catch (e) {
            if (opts.handle?.stopped) return false;
            /* the progress route is not available: send it the plain way below (no percentage) */
        }
    }
    const r = await new File(uri).upload(url, { httpMethod: method === 'POST' ? 'POST' : 'PUT', uploadType: UploadType.BINARY_CONTENT, headers });
    return r.status >= 200 && r.status < 300;
}
