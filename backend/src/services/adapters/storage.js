// File storage adapter (Cloudflare R2).
//
// Direct upload flow (the file never passes through this server):
//   presignPut() -> app uploads to R2 with PUT -> head() + peek() check the real file -> Media record.
//   remove(key) deletes an object.
//
// STORAGE_MOCK=true -> local folder (.mock-storage). Direct upload is not available in mock mode.
// otherwise         -> R2. Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(process.cwd(), '.mock-storage');

// no "..", no leading slash, only safe characters
const safeKey = (key) => {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9/_.-]{1,300}$/.test(key) || key.includes('..') || key.startsWith('/')) {
        throw new Error('Invalid storage key');
    }
    return key;
};

const publicUrl = (key) => {
    const base = (process.env.STORAGE_MOCK === 'true'
        ? `${process.env.PUBLIC_BASE_URL || 'http://localhost:5000'}/mock-storage`
        : process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
    return `${base}/${safeKey(key)}`;
};

/* ------------------------------ mock ------------------------------ */
const mockProvider = {
    async put({ key, buffer }) {
        const file = path.join(ROOT, safeKey(key));
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buffer);
        return { key, url: publicUrl(key) };
    },
    async remove(key) {
        await fs.rm(path.join(ROOT, safeKey(key)), { force: true });
    },
    async presignPut() {
        throw Object.assign(new Error('Direct upload needs R2. Set STORAGE_MOCK=false and add the R2 keys.'), { status: 501 });
    },
    async head(key) {
        const st = await fs.stat(path.join(ROOT, safeKey(key)));
        return { bytes: st.size, contentType: null };
    },
    async peek(key, n = 12) {
        const fh = await fs.open(path.join(ROOT, safeKey(key)), 'r');
        try {
            const buf = Buffer.alloc(n);
            const { bytesRead } = await fh.read(buf, 0, n, 0);
            return buf.subarray(0, bytesRead);
        } finally {
            await fh.close();
        }
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
            // R2 does not accept the newer default checksum headers
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        });
    }
    return client;
};
const bucket = () => {
    if (!process.env.R2_BUCKET) throw new Error('R2_BUCKET is not set');
    return process.env.R2_BUCKET;
};

const realProvider = {
    async put({ key, buffer, contentType }) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: safeKey(key), Body: buffer, ContentType: contentType }));
        return { key, url: publicUrl(key) };
    },
    async remove(key) {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: safeKey(key) }));
    },
    // a short-lived URL: the app sends the file with PUT, same Content-Type, exact size
    async presignPut({ key, contentType, bytes, expiresIn = 300 }) {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const cmd = new PutObjectCommand({ Bucket: bucket(), Key: safeKey(key), ContentType: contentType, ContentLength: bytes });
        return getSignedUrl(s3(), cmd, { expiresIn });
    },
    async head(key) {
        const { HeadObjectCommand } = require('@aws-sdk/client-s3');
        const r = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: safeKey(key) }));
        return { bytes: r.ContentLength, contentType: r.ContentType };
    },
    // first bytes of the file, to check the real type
    async peek(key, n = 12) {
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: safeKey(key), Range: `bytes=0-${n - 1}` }));
        return Buffer.from(await r.Body.transformToByteArray());
    },
};

const provider = () => (process.env.STORAGE_MOCK === 'true' ? mockProvider : realProvider);

module.exports = {
    put: (args) => provider().put(args),
    remove: (key) => provider().remove(key),
    presignPut: (args) => provider().presignPut(args),
    head: (key) => provider().head(key),
    peek: (key, n) => provider().peek(key, n),
    publicUrl,
    safeKey,
};