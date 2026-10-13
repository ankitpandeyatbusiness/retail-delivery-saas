// Storage for database backups. A PRIVATE bucket, never the public image bucket.
//   STORAGE_MOCK=true -> local folder .mock-backups
//   otherwise         -> R2 bucket BACKUP_R2_BUCKET (same R2 account keys as the image storage)
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ROOT = path.join(process.cwd(), '.mock-backups');
const isMock = () => process.env.STORAGE_MOCK === 'true';

const safeKey = (key) => {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9/_.-]{1,300}$/.test(key) || key.includes('..') || key.startsWith('/')) {
        throw new Error('Invalid backup key');
    }
    return key;
};

/* ------------------------------ mock ------------------------------ */
const mock = {
    async putFile(key, file) {
        const dest = path.join(ROOT, safeKey(key));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.copyFile(file, dest);
    },
    async putBuffer(key, buffer) {
        const dest = path.join(ROOT, safeKey(key));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, buffer);
    },
    async getBuffer(key) {
        return fsp.readFile(path.join(ROOT, safeKey(key)));
    },
    async exists(key) {
        try { await fsp.stat(path.join(ROOT, safeKey(key))); return true; } catch { return false; }
    },
    async list(prefix = '') {
        const out = [];
        const walk = async (dir) => {
            let ents;
            try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
            for (const e of ents) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) { await walk(full); continue; }
                const key = path.relative(ROOT, full).split(path.sep).join('/');
                if (!key.startsWith(prefix)) continue;
                const st = await fsp.stat(full);
                out.push({ key, size: st.size, lastModified: st.mtime });
            }
        };
        await walk(ROOT);
        return out;
    },
    async remove(key) {
        await fsp.rm(path.join(ROOT, safeKey(key)), { force: true });
    },
};

/* ------------------------------ R2 ------------------------------ */
let client;
const s3 = () => {
    if (!client) {
        const { S3Client } = require('@aws-sdk/client-s3');
        const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
        if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error('R2 keys are not set');
        client = new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        });
    }
    return client;
};
const bucket = () => {
    if (!process.env.BACKUP_R2_BUCKET) throw new Error('BACKUP_R2_BUCKET is not set');
    if (process.env.BACKUP_R2_BUCKET === process.env.R2_BUCKET) throw new Error('The backup bucket must not be the public image bucket');
    return process.env.BACKUP_R2_BUCKET;
};

const real = {
    async putFile(key, file) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const size = (await fsp.stat(file)).size;
        await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: safeKey(key), Body: fs.createReadStream(file), ContentLength: size }));
    },
    async putBuffer(key, buffer) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: safeKey(key), Body: buffer, ContentLength: buffer.length }));
    },
    async getBuffer(key) {
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: safeKey(key) }));
        return Buffer.from(await r.Body.transformToByteArray());
    },
    async exists(key) {
        const { HeadObjectCommand } = require('@aws-sdk/client-s3');
        try { await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: safeKey(key) })); return true; } catch { return false; }
    },
    async list(prefix = '') {
        const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
        const out = [];
        let token;
        do {
            const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
            for (const o of r.Contents || []) out.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
            token = r.IsTruncated ? r.NextContinuationToken : undefined;
        } while (token);
        return out;
    },
    async remove(key) {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: safeKey(key) }));
    },
};

const p = () => (isMock() ? mock : real);
const configured = () => isMock() || !!(process.env.BACKUP_R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

module.exports = {
    putFile: (k, f) => p().putFile(k, f),
    putBuffer: (k, b) => p().putBuffer(k, b),
    getBuffer: (k) => p().getBuffer(k),
    exists: (k) => p().exists(k),
    list: (prefix) => p().list(prefix),
    remove: (k) => p().remove(k),
    configured,
    safeKey,
};