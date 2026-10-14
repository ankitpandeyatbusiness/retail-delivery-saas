// Platform default hero images: the files in the bucket folder defaults/hero/ (sorted by name).
// A shop with no hero images of its own gets these, so every app build has a login picture.
// Not tied to any shop and not in Media, so the upload cleanup (tenants/ only) never touches them.
const storage = require('./adapters/storage');

const PREFIX = 'defaults/hero/';
const TTL_MS = 10 * 60 * 1000;
const IMAGE_RE = /\.(webp|png|jpe?g)$/i;

let cached = null;   // { at, urls }

async function getDefaultHeroUrls() {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.urls;
    try {
        const files = await storage.list(PREFIX);
        const urls = files
            .filter((o) => IMAGE_RE.test(o.key))
            .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }))
            .map((o) => storage.publicUrl(o.key));
        cached = { at: Date.now(), urls };
        return urls;
    } catch (e) {
        console.error('Default hero images: could not list the bucket:', e.message);
        return cached ? cached.urls : [];   // an old answer is better than a blank login screen
    }
}

const resetDefaultHeroCache = () => { cached = null; };

module.exports = { PREFIX, getDefaultHeroUrls, resetDefaultHeroCache };
