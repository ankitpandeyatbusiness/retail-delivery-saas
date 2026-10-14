#!/usr/bin/env node
// Downloads a shop's app icon, adaptive icon and splash from the media bucket (CDN) before the app is built.
//   node scripts/fetch-branding.js <tenant-slug> <out-dir>
//   env: MEDIA_CDN_URL  public base of the bucket, e.g. https://media.example.com
// Files are read from <MEDIA_CDN_URL>/tenants/<slug>/branding/. They are put there through the backend
// (kind icon / adaptive / splash), never committed to this repo.
//
// Prints one JSON line: { icon, adaptive, splash } with the saved file name or null for each.
// A copy downloaded in the last 10 minutes is reused (Expo reads app.config.js several times per build).
// If the download fails and an older copy exists, the older copy is used.

const fs = require('fs');
const path = require('path');

const FILES = { icon: 'icon.png', adaptive: 'adaptive-foreground.png', splash: 'splash.png' };
const FRESH_MS = 10 * 60 * 1000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const [slug, outDir] = process.argv.slice(2);
const base = (process.env.MEDIA_CDN_URL || '').replace(/\/+$/, '');
// slug "default" is the platform default app: defaults/branding/ (not a shop folder)
const folderUrl = () => `${base}/${slug === 'default' ? 'defaults' : `tenants/${slug}`}/branding`;

async function download(name) {
    const dest = path.join(outDir, name);
    const age = fs.existsSync(dest) ? Date.now() - fs.statSync(dest).mtimeMs : Infinity;
    if (age < FRESH_MS) return name;
    try {
        const res = await fetch(`${folderUrl()}/${name}`, { signal: AbortSignal.timeout(20000) });
        if (res.status === 404) return fs.existsSync(dest) ? name : null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 8 || !buf.subarray(0, 4).equals(PNG_MAGIC)) throw new Error('not a PNG file');
        fs.writeFileSync(dest, buf);
        return name;
    } catch (e) {
        process.stderr.write(`[branding] ${name}: ${e.message}\n`);
        return fs.existsSync(dest) ? name : null;   // an older copy is better than nothing
    }
}

(async () => {
    if (!slug || !outDir || !/^[a-z0-9-]{3,40}$/.test(slug)) {
        process.stderr.write('usage: fetch-branding.js <tenant-slug> <out-dir>\n');
        process.exit(2);
    }
    if (!base) {
        process.stderr.write('[branding] MEDIA_CDN_URL is not set\n');
        process.stdout.write(JSON.stringify({ icon: null, adaptive: null, splash: null }));
        return;
    }
    fs.mkdirSync(outDir, { recursive: true });
    const out = {};
    for (const [k, name] of Object.entries(FILES)) out[k] = await download(name);
    process.stdout.write(JSON.stringify(out));
})();
