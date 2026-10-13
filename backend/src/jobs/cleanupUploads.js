// B15: every 6 hours, delete files in storage under tenants/ that are older than 24 hours
// and have no Media record (uploads that were never confirmed, or leftovers of a failed confirm).
// Mock storage does nothing (unless CLEANUP_UPLOADS_IN_MOCK=true, used by the tests).
const storage = require('../services/adapters/storage');
const Media = require('../models/Media');

const AGE_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_DELETES = 1000;       // one run never deletes more than this
const CHUNK = 500;

async function runCleanupUploads({ now = Date.now() } = {}) {
    if (process.env.STORAGE_MOCK === 'true' && process.env.CLEANUP_UPLOADS_IN_MOCK !== 'true') return { skipped: true, scanned: 0, deleted: 0 };

    const old = (await storage.list('tenants/')).filter((o) => o.lastModified && now - new Date(o.lastModified).getTime() > AGE_MS);
    if (!old.length) return { scanned: 0, deleted: 0 };

    // safety: an empty Media collection while files exist means a wrong database, not 1000 orphans
    if ((await Media.estimatedDocumentCount()) === 0) {
        console.error('Cleanup uploads: Media is empty but storage has files. Nothing deleted.');
        return { scanned: old.length, deleted: 0, guarded: true };
    }

    let deleted = 0;
    for (let i = 0; i < old.length && deleted < MAX_DELETES; i += CHUNK) {
        const part = old.slice(i, i + CHUNK);
        const known = new Set((await Media.find({ key: { $in: part.map((o) => o.key) } }).select('key').lean()).map((m) => m.key));
        for (const o of part) {
            if (known.has(o.key) || deleted >= MAX_DELETES) continue;
            try { await storage.remove(o.key); deleted += 1; } catch (e) { console.error('Cleanup uploads: remove failed', o.key, e.message); }
        }
    }
    return { scanned: old.length, deleted };
}

let running = false;
function startCleanupUploadsScheduler() {
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runCleanupUploads();
            if (r.deleted) console.log(`Cleanup uploads: ${r.deleted} unused file(s) deleted`);
        } catch (e) {
            console.error('Cleanup uploads error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 10 * 60 * 1000).unref?.();
    setInterval(run, EVERY_MS).unref?.();
}

module.exports = { runCleanupUploads, startCleanupUploadsScheduler };