// B15: every 6 hours, delete files in storage under tenants/ that are older than 24 hours
// and have no Media record (uploads that were never confirmed, or leftovers of a failed confirm).
// Also: complaint photos that were uploaded and confirmed but never sent with a complaint (the customer closed the
// app before pressing Send). They have a Media record, so the first rule keeps them, and they would count toward the
// limit of 3 photos for that order forever.
// Mock storage does nothing (unless CLEANUP_UPLOADS_IN_MOCK=true, used by the tests).
const mongoose = require('mongoose');
const storage = require('../services/adapters/storage');
const Media = require('../models/Media');
const Complaint = require('../models/Complaint');
const Tenant = require('../models/Tenant');

const AGE_MS = 24 * 60 * 60 * 1000;
const HERO_ORPHAN_AGE_MS = 60 * 60 * 1000;   // a hero image is added to the list within seconds of its upload
const EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_DELETES = 1000;       // one run never deletes more than this
const CHUNK = 500;
// A photo is attached to a complaint within minutes of uploading, so one that is this old and still unused is abandoned.
const COMPLAINT_PHOTO_AGE_MS = 6 * 60 * 60 * 1000;

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

// Complaint photos that no complaint uses. Returns { scanned, deleted }.
async function runCleanupComplaintPhotos({ now = Date.now() } = {}) {
    if (process.env.STORAGE_MOCK === 'true' && process.env.CLEANUP_UPLOADS_IN_MOCK !== 'true') return { skipped: true, scanned: 0, deleted: 0 };

    const cutoff = new Date(now - COMPLAINT_PHOTO_AGE_MS);
    let scanned = 0;
    let deleted = 0;
    let after = null;   // walk by _id so a photo we keep (it is used) is never looked at twice in one run

    while (deleted < MAX_DELETES) {
        const filter = { kind: 'complaint', createdAt: { $lt: cutoff }, ...(after ? { _id: { $gt: after } } : {}) };
        const part = await Media.find(filter).sort({ _id: 1 }).limit(CHUNK).lean();
        if (!part.length) break;
        scanned += part.length;
        after = part[part.length - 1]._id;

        // every photo URL that some complaint of these orders really uses
        const orderIds = [...new Set(part.map((m) => m.refId).filter((id) => mongoose.isValidObjectId(id)))];
        const used = new Set();
        const complaints = await Complaint.find({ orderId: { $in: orderIds } }).select('tenantId orderId photos').lean();
        for (const c of complaints) for (const u of c.photos || []) used.add(`${c.tenantId}|${c.orderId}|${u}`);

        for (const m of part) {
            if (deleted >= MAX_DELETES) break;
            if (used.has(`${m.tenantId}|${m.refId}|${m.url}`)) continue;
            try {
                await storage.remove(m.key);
                await Media.deleteOne({ _id: m._id });
                deleted += 1;
            } catch (e) { console.error('Cleanup complaint photos: remove failed', m.key, e.message); }
        }
    }
    return { scanned, deleted };
}

// Hero images that are in storage and in Media but not in the shop's hero list any more
// (for example a failed save). Deleted from storage and from Media.
async function runCleanupHeroOrphans({ now = Date.now() } = {}) {
    if (process.env.STORAGE_MOCK === 'true' && process.env.CLEANUP_UPLOADS_IN_MOCK !== 'true') return { skipped: true, scanned: 0, deleted: 0 };

    const cutoff = new Date(now - HERO_ORPHAN_AGE_MS);
    let scanned = 0;
    let deleted = 0;
    let after = null;

    while (deleted < MAX_DELETES) {
        const filter = { kind: 'hero', createdAt: { $lt: cutoff }, ...(after ? { _id: { $gt: after } } : {}) };
        const part = await Media.find(filter).sort({ _id: 1 }).limit(CHUNK).lean();
        if (!part.length) break;
        scanned += part.length;
        after = part[part.length - 1]._id;

        const tenants = await Tenant.find({ _id: { $in: [...new Set(part.map((m) => String(m.tenantId)))] } }).select('heroImages').lean();
        const used = new Set(tenants.flatMap((t) => (t.heroImages || []).map((u) => `${t._id}|${u}`)));

        for (const m of part) {
            if (deleted >= MAX_DELETES) break;
            if (used.has(`${m.tenantId}|${m.url}`)) continue;
            try {
                await storage.remove(m.key);
                await Media.deleteOne({ _id: m._id });
                deleted += 1;
            } catch (e) { console.error('Cleanup hero images: remove failed', m.key, e.message); }
        }
    }
    return { scanned, deleted };
}

let running = false;
function startCleanupUploadsScheduler() {
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await runCleanupUploads();
            if (r.deleted) console.log(`Cleanup uploads: ${r.deleted} unused file(s) deleted`);
            const c = await runCleanupComplaintPhotos();
            if (c.deleted) console.log(`Cleanup uploads: ${c.deleted} unsent complaint photo(s) deleted`);
            const h = await runCleanupHeroOrphans();
            if (h.deleted) console.log(`Cleanup uploads: ${h.deleted} unused hero image(s) deleted`);
        } catch (e) {
            console.error('Cleanup uploads error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 10 * 60 * 1000).unref?.();
    setInterval(run, EVERY_MS).unref?.();
}

module.exports = { runCleanupUploads, runCleanupComplaintPhotos, runCleanupHeroOrphans, startCleanupUploadsScheduler };