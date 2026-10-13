// Database backup and restore, in plain Node (the free Atlas plan has no backups, and Render has no mongodump).
// A backup is a folder in the PRIVATE backup bucket:
//   <prefix>/daily/YYYY-MM-DD/   (kept 7)      <prefix>/weekly/YYYY-Www/   (kept 4, made on Sundays, Indian time)
//     c0001.jsonl.gz ...           one file per collection, one document per line (canonical Extended JSON)
//     manifest.json                collection names, counts and indexes. It is written LAST: no manifest = not a backup.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');
const defaultStore = require('./adapters/backupStorage');

const BSON = (() => {
    try { if (mongoose.mongo.BSON && mongoose.mongo.BSON.EJSON) return mongoose.mongo.BSON; } catch { /* use the package */ }
    return require('bson');
})();
const { EJSON } = BSON;

const KEEP = { daily: 7, weekly: 4 };
const FOLDER_RE = { daily: /^\d{4}-\d{2}-\d{2}$/, weekly: /^\d{4}-W\d{2}$/ };
const RESTORE_FOLDER_RE = /^(daily\/\d{4}-\d{2}-\d{2}|weekly\/\d{4}-W\d{2})$/;
// worthless in a backup (and sensitive): login sessions, OTPs, rate limit counters, job locks, live feed lines
const SKIP_NAMES = ['sessions', 'otprequests', 'adminotps', 'feedevents', 'job_locks'];

const prefix = () => (process.env.BACKUP_R2_PREFIX || 'db-backups').replace(/^\/+|\/+$/g, '');

function skipped(name) {
    const extra = String(process.env.BACKUP_SKIP || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const n = name.toLowerCase();
    return n.startsWith('system.') || n.startsWith('rl_') || SKIP_NAMES.includes(n) || extra.includes(n);
}

function isoWeek(shifted) {
    const t = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y = t.getUTCFullYear();
    const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return `${y}-W${String(w).padStart(2, '0')}`;
}
function istParts(now) {
    const s = new Date(now + 330 * 60 * 1000);
    return { day: s.toISOString().slice(0, 10), dow: s.getUTCDay(), week: isoWeek(s) };
}

async function dumpCollection(db, name, file) {
    const cursor = db.collection(name).find({});
    let count = 0;
    const lines = (async function* gen() {
        for await (const doc of cursor) {
            count += 1;
            yield `${EJSON.stringify(doc, { relaxed: false })}\n`;
        }
    }());
    await pipeline(Readable.from(lines), zlib.createGzip(), fs.createWriteStream(file));
    return count;
}

async function prune({ store = defaultStore } = {}) {
    const removed = [];
    for (const kind of ['daily', 'weekly']) {
        const base = `${prefix()}/${kind}/`;
        const rows = await store.list(base);
        const folders = new Map();
        for (const r of rows) {
            const name = r.key.slice(base.length).split('/')[0];
            if (!FOLDER_RE[kind].test(name)) continue;           // never touch anything we did not make
            if (!folders.has(name)) folders.set(name, []);
            folders.get(name).push(r.key);
        }
        const old = [...folders.keys()].sort().reverse().slice(KEEP[kind]);
        for (const name of old) {
            for (const key of folders.get(name)) await store.remove(key);
            removed.push(`${kind}/${name}`);
        }
    }
    return removed;
}

async function createBackup({ db = mongoose.connection.db, now = Date.now(), store = defaultStore } = {}) {
    const t = istParts(now);
    const targets = [`${prefix()}/daily/${t.day}/`];
    if (t.dow === 0) targets.push(`${prefix()}/weekly/${t.week}/`);

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dbbackup-'));
    try {
        const infos = await db.listCollections({}, { nameOnly: true }).toArray();
        const names = infos.filter((c) => (!c.type || c.type === 'collection') && !skipped(c.name)).map((c) => c.name).sort();

        const manifest = { version: 1, createdAt: new Date(now).toISOString(), collections: [] };
        let documents = 0;
        let bytes = 0;
        for (let i = 0; i < names.length; i += 1) {
            const file = `c${String(i + 1).padStart(4, '0')}.jsonl.gz`;
            const local = path.join(tmp, file);
            const count = await dumpCollection(db, names[i], local);
            const size = (await fsp.stat(local)).size;
            const indexes = (await db.collection(names[i]).indexes().catch(() => []))
                .filter((x) => x.name !== '_id_')
                .map(({ v, ns, ...rest }) => rest);
            manifest.collections.push({ name: names[i], file, count, bytes: size, indexes });
            documents += count;
            bytes += size;
        }

        for (const target of targets) {
            for (const c of manifest.collections) await store.putFile(`${target}${c.file}`, path.join(tmp, c.file));
            await store.putBuffer(`${target}manifest.json`, Buffer.from(JSON.stringify(manifest)));    // last
        }
        const removed = await prune({ store });
        return { day: t.day, targets, collections: names.length, documents, bytes, pruned: removed };
    } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
    }
}

// Complete backups only (the ones that have a manifest)
async function listBackups({ store = defaultStore } = {}) {
    const out = { daily: [], weekly: [] };
    for (const kind of ['daily', 'weekly']) {
        const base = `${prefix()}/${kind}/`;
        for (const r of await store.list(base)) {
            const rest = r.key.slice(base.length).split('/');
            if (rest[1] === 'manifest.json' && FOLDER_RE[kind].test(rest[0])) out[kind].push(rest[0]);
        }
        out[kind].sort().reverse();
    }
    return out;
}

// folder: 'daily/2026-10-14' or 'weekly/2026-W42'
// Restores into `db`. A collection that already has documents is refused unless drop is true.
async function restoreBackup({ db, folder, drop = false, store = defaultStore }) {
    if (!RESTORE_FOLDER_RE.test(String(folder))) throw new Error('Folder must look like daily/YYYY-MM-DD or weekly/YYYY-Www');
    const base = `${prefix()}/${folder}/`;
    if (!(await store.exists(`${base}manifest.json`))) throw new Error('This backup is incomplete or does not exist (no manifest)');
    const manifest = JSON.parse((await store.getBuffer(`${base}manifest.json`)).toString('utf8'));

    // check everything first, so a refusal leaves the target untouched
    if (!drop) {
        for (const c of manifest.collections) {
            if ((await db.collection(c.name).countDocuments({}, { limit: 1 })) > 0) {
                throw new Error(`Collection ${c.name} is not empty. Restore into an empty database, or pass drop.`);
            }
        }
    }

    let documents = 0;
    for (const c of manifest.collections) {
        const col = db.collection(c.name);
        if (drop) await col.drop().catch(() => { });          // "ns not found" is fine

        const input = Readable.from(await store.getBuffer(`${base}${c.file}`)).pipe(zlib.createGunzip());
        const rl = readline.createInterface({ input, crlfDelay: Infinity });
        let batch = [];
        for await (const line of rl) {
            if (!line) continue;
            batch.push(EJSON.parse(line, { relaxed: false }));
            if (batch.length >= 500) { await col.insertMany(batch, { ordered: false }); documents += batch.length; batch = []; }
        }
        if (batch.length) { await col.insertMany(batch, { ordered: false }); documents += batch.length; }

        for (const { key, ...options } of c.indexes || []) await col.createIndex(key, options);     // after the data: faster
    }
    return { collections: manifest.collections.length, documents, createdAt: manifest.createdAt };
}

module.exports = { createBackup, restoreBackup, listBackups, prune, istParts, skipped };