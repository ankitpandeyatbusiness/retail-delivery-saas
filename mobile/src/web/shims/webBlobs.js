// Files on the website live in memory as Blobs (a browser has no app folders). Shared by the expo-file-system and expo-sharing stand-ins.
export const blobs = new Map();   // uri -> Blob

export const nameOf = (uri) => {
    const last = String(uri || '').split('?')[0].split('/').pop() || 'file';
    try { return decodeURIComponent(last); } catch (e) { return last; }
};

// a file we wrote ourselves, or any address the browser can fetch (a picked picture's blob: address, a data: address, https)
export async function blobOf(uri) {
    if (blobs.has(uri)) return blobs.get(uri);
    const r = await fetch(uri);
    if (!r.ok) throw new Error(`Could not read the file (${r.status})`);
    return r.blob();
}

// "download": the browser's normal Save, with the file name. Not blocked like a pop-up window would be.
export function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'file';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
