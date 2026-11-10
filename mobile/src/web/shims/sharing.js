// Web stand-in for expo-sharing: "share" = the browser downloads the file (a PDF, a sheet, a picture) with its name.
import { blobOf, nameOf, saveBlob } from './webBlobs';

export async function isAvailableAsync() { return true; }

export async function shareAsync(uri, options = {}) {
    const blob = await blobOf(uri);
    saveBlob(blob, nameOf(uri));
}
