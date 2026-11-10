// Web stand-in for expo-file-system/legacy: an upload with progress (and Cancel) for a picked picture.
import { blobOf } from './webBlobs';

export const FileSystemUploadType = { BINARY_CONTENT: 0, MULTIPART: 1 };

export function createUploadTask(url, fileUri, options = {}, onProgress) {
    const xhr = new XMLHttpRequest();
    return {
        async uploadAsync() {
            const blob = await blobOf(fileUri);
            return new Promise((resolve, reject) => {
                xhr.open(options.httpMethod || 'PUT', url);
                Object.entries(options.headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));
                xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress({ totalBytesSent: e.loaded, totalBytesExpectedToSend: e.total }); };
                xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
                xhr.onerror = () => reject(new Error('Upload failed'));
                xhr.onabort = () => resolve(null);   // cancelled
                xhr.send(blob);
            });
        },
        async cancelAsync() { xhr.abort(); },
    };
}
