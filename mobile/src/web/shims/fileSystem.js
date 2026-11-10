// Web stand-in for expo-file-system (the new File / Directory / Paths API): files are Blobs kept in memory.
// Only what the app uses: write a downloaded PDF/sheet, read back, upload a picked file to a signed storage address, download a file.
import { blobs, blobOf, nameOf } from './webBlobs';

export const Paths = { cache: 'web-cache', document: 'web-document', bundle: 'web-bundle' };
export const UploadType = { BINARY_CONTENT: 0, MULTIPART: 1 };

export class File {
    constructor(...parts) {
        const last = String(parts[parts.length - 1]);
        this.uri = parts.length === 1 ? last : `web-file://${last}`;   // File(uri), or File(folder, name)
        this.name = nameOf(this.uri);
    }
    get exists() { return blobs.has(this.uri); }
    get contentUri() { return this.uri; }
    get size() { const b = blobs.get(this.uri); return b ? b.size : 0; }
    create() { if (!blobs.has(this.uri)) blobs.set(this.uri, new Blob([])); }
    write(data) { blobs.set(this.uri, new Blob([data])); }
    delete() { blobs.delete(this.uri); }
    async bytes() { return new Uint8Array(await (await blobOf(this.uri)).arrayBuffer()); }
    async text() { return (await blobOf(this.uri)).text(); }
    // send the file as it is to a signed storage address. { status, body }
    async upload(url, opts = {}) {
        const blob = await blobOf(this.uri);
        const r = await fetch(url, { method: opts.httpMethod || 'PUT', headers: opts.headers, body: blob });
        return { status: r.status, body: await r.text().catch(() => '') };
    }
    static async downloadFileAsync(url, dest) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Download failed (${r.status})`);
        blobs.set(dest.uri, await r.blob());
        return dest;
    }
}

// no folders to pick on a website
export class Directory {
    list() { return []; }
    createDirectory() { return new Directory(); }
    createFile(name) { return new File(Paths.cache, name); }
    static async pickDirectoryAsync() { throw new Error('Not available on the website'); }
}
