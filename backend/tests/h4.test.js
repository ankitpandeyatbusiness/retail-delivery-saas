require('./helpers/env');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const storage = require('../src/services/adapters/storage');
const Media = require('../src/models/Media');
const { runCleanupUploads, runCleanupComplaintPhotos } = require('../src/jobs/cleanupUploads');
const Complaint = require('../src/models/Complaint');

process.env.SECRETS_KEY = process.env.SECRETS_KEY || crypto.randomBytes(32).toString('base64');
const box = require('../src/utils/secretBox');

const ROOT = path.join(process.cwd(), '.mock-storage');
const age = (key, hours) => {
    const t = new Date(Date.now() - hours * 3600 * 1000);
    return fs.utimes(path.join(ROOT, key), t, t);
};
const exists = (key) => storage.head(key).then(() => true, () => false);

describe('H4 secret box (no database)', () => {
    test('a secret goes in and comes out, and the stored text is not the secret', () => {
        const t = box.encrypt('my-msg91-key');
        assert.match(t, /^v1:/);
        assert.ok(!t.includes('my-msg91-key'));
        assert.equal(box.decrypt(t), 'my-msg91-key');
    });
    test('the same secret gives different text every time', () => {
        assert.notEqual(box.encrypt('abc'), box.encrypt('abc'));
    });
    test('changed text and bad text are refused', () => {
        const t = box.encrypt('abc');
        const parts = t.split(':');
        parts[3] = Buffer.from('zzzz').toString('base64');
        assert.throws(() => box.decrypt(parts.join(':')));
        assert.throws(() => box.decrypt('nonsense'));
    });
    test('a missing or short key is an error', () => {
        const old = process.env.SECRETS_KEY;
        process.env.SECRETS_KEY = '';
        assert.throws(() => box.encrypt('x'), /SECRETS_KEY/);
        process.env.SECRETS_KEY = Buffer.from('short').toString('base64');
        assert.throws(() => box.encrypt('x'), /32 bytes/);
        process.env.SECRETS_KEY = old;
    });
});

describe('H4 cleanup of unused uploads', () => {
    before(async () => {
        process.env.STORAGE_MOCK = 'true';
        process.env.CLEANUP_UPLOADS_IN_MOCK = 'true';
        await db.connect();
    });
    after(async () => {
        delete process.env.CLEANUP_UPLOADS_IN_MOCK;
        await fs.rm(path.join(ROOT, 'tenants', 'h4-clean'), { recursive: true, force: true });
        await db.disconnect();
    });

    test('old files without a Media record go; old files with a record and young files stay', async () => {
        const buf = Buffer.from('x');
        const keys = {
            orphanOld: 'tenants/h4-clean/tmp/u1/a.jpg',
            keptOld: 'tenants/h4-clean/logo/20260101-aaaaaaaa.webp',
            orphanYoung: 'tenants/h4-clean/tmp/u1/b.jpg',
        };
        for (const k of Object.values(keys)) await storage.put({ key: k, buffer: buf });
        await age(keys.orphanOld, 30);
        await age(keys.keptOld, 30);
        await age(keys.orphanYoung, 2);
        await Media.create({ tenantId: new mongoose.Types.ObjectId(), key: keys.keptOld, url: 'http://x/y', kind: 'logo' });

        const r = await runCleanupUploads();
        assert.ok(r.deleted >= 1);
        assert.equal(await exists(keys.orphanOld), false);
        assert.equal(await exists(keys.keptOld), true);
        assert.equal(await exists(keys.orphanYoung), true);
        assert.equal((await runCleanupUploads()).deleted, 0);          // a second run finds nothing
    });

    test('with no Media records at all nothing is deleted (wrong database guard)', async () => {
        const k = 'tenants/h4-clean/tmp/u2/c.jpg';
        await storage.put({ key: k, buffer: Buffer.from('x') });
        await age(k, 30);
        await Media.deleteMany({});
        const r = await runCleanupUploads();
        assert.equal(r.guarded, true);
        assert.equal(await exists(k), true);
    });

    test('in mock mode without the test switch the job does nothing', async () => {
        delete process.env.CLEANUP_UPLOADS_IN_MOCK;
        const r = await runCleanupUploads();
        assert.equal(r.skipped, true);
        process.env.CLEANUP_UPLOADS_IN_MOCK = 'true';
    });
});

describe('H4 cleanup of complaint photos that were never sent', () => {
    before(async () => {
        process.env.STORAGE_MOCK = 'true';
        process.env.CLEANUP_UPLOADS_IN_MOCK = 'true';
        await db.connect();
    });
    after(async () => {
        delete process.env.CLEANUP_UPLOADS_IN_MOCK;
        await fs.rm(path.join(ROOT, 'tenants', 'h4-cp'), { recursive: true, force: true });
        await db.disconnect();
    });

    test('an old unused complaint photo goes; used, young and other kinds stay', async () => {
        const tenantId = new mongoose.Types.ObjectId();
        const orderId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();
        const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

        const mk = async (name, { kind = 'complaint', hours }) => {
            const key = `tenants/h4-cp/complaints/${name}.webp`;
            await storage.put({ key, buffer: Buffer.from('x') });
            const m = await Media.create({ tenantId, key, url: `https://cdn.test/${key}`, kind, refId: String(orderId) });
            await Media.collection.updateOne({ _id: m._id }, { $set: { createdAt: hoursAgo(hours) } });
            return { key, url: m.url, id: m._id };
        };

        const used = await mk('used', { hours: 30 });
        const unusedOld = await mk('unused-old', { hours: 30 });
        const unusedYoung = await mk('unused-young', { hours: 1 });
        const otherKind = await mk('avatar-like', { kind: 'customer', hours: 30 });

        await Complaint.create({ tenantId, orderId, userId, type: 'quality', text: 'cold food', photos: [used.url] });

        const r = await runCleanupComplaintPhotos();
        assert.equal(r.deleted, 1);
        assert.equal(await exists(unusedOld.key), false);
        assert.equal(await Media.exists({ _id: unusedOld.id }), null);
        assert.equal(await exists(used.key), true);
        assert.ok(await Media.exists({ _id: used.id }));
        assert.equal(await exists(unusedYoung.key), true);
        assert.equal(await exists(otherKind.key), true);
        assert.equal((await runCleanupComplaintPhotos()).deleted, 0);   // a second run finds nothing
    });

    test('in mock mode without the test switch it does nothing', async () => {
        delete process.env.CLEANUP_UPLOADS_IN_MOCK;
        const r = await runCleanupComplaintPhotos();
        assert.equal(r.skipped, true);
        process.env.CLEANUP_UPLOADS_IN_MOCK = 'true';
    });
});
