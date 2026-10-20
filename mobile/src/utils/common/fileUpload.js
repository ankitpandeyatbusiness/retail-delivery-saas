// Sending a picked picture to storage straight from the file, without turning it into a Blob first
// (a Blob copies the whole picture through the native side, which is slow and warns).
import { File, UploadType } from 'expo-file-system';

// size of the picked file in bytes (0 when it cannot be read)
export function fileSize(uri) {
    try { return new File(uri).size || 0; } catch (e) { return 0; }
}

// PUT the file to a signed storage URL. true when storage accepted it.
export async function putFile(uri, { url, method, headers }) {
    const r = await new File(uri).upload(url, { httpMethod: method === 'POST' ? 'POST' : 'PUT', uploadType: UploadType.BINARY_CONTENT, headers });
    return r.status >= 200 && r.status < 300;
}
