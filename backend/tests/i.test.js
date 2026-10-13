require('./helpers/env');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const db = require('./helpers/db');
const { makeTenant } = require('./helpers/factory');
const sentry = require('../src/utils/sentry');
const backups = require('../src/services/backupService');
const store = require('../src/services/adapters/backupStorage');
const { runDailyOnce } = require('../src/utils/dailyJob');
const { runNightlyReconcile } = require('../src/jobs/nightlyReconcile');
const wallet = require('../src/services/smsWalletService');
const SmsWallet = require('../src/models/SmsWallet');
const Notification = require('../src/models/Notification');

const { Int32, Double } = mongoose.mongo;
const ROOT = path.join(process.cwd(), '.mock-backups');
const WED = Date.parse('2026-10-14T03:00:00+05:30');
const SUN = Date.parse('2026-10-18T03:00:00+05:30');
const manifestOf = async (folder) => JSON.parse((await store.getBuffer(`db-backups/${folder}/manifest.json`)).toString());

describe('I error reporting (no database)', () => {
    test('without SENTRY_DSN nothing starts and nothing breaks', () => {
        delete process.env.SENTRY_DSN;
        sentry._setClient(null);
        assert.equal(sentry.init(), false);
        assert.doesNotThrow(() => sentry.capture(new Error('x')));
    });
    test('a report loses cookies, tokens, bodies and the IP', () => {
        const e = sentry.scrub({
            request: { cookies: { a: 1 }, data: { phone: '98' }, query_string: 'x=1', headers: { authorization: 'Bearer t', cookie: 'c', accept: 'json' } },
            user: { id: '1', ip_address: '1.2.3.4', email: 'a@b.c' },
        });
        assert.deepEqual(e.request.headers, { accept: 'json' });
        assert.equal(e.request.data, undefined);
        assert.equal(e.request.cookies, undefined);
        assert.equal(e.user.ip_address, undefined);
        assert.equal(e.user.email, undefined);
        assert.equal(e.user.id, '1');
    });
    test('capture sends an Error with small facts, and wraps plain text in an Error', () => {
        const fake = { captureException: mock.fn(), flush: async () => true };
        sentry._setClient(fake);
        sentry.capture(new Error('boom'), { job: 'a' });
        sentry.capture('text only');
        sentry._setClient(null);
        assert.equal(fake.captureException.mock.calls.length, 2);
        assert.ok(fake.captureException.mock.calls[0].arguments[0] instanceof Error);
        assert.deepEqual(fake.captureException.mock.calls[0].arguments[1], { extra: { job: 'a' } });
        assert.ok(fake.captureException.mock.calls[1].arguments[0] instanceof Error);
    });
});

describe('I database backup and restore', () => {
    let copy;
    let tenantCount;
    before(async () => {
        process.env.STORAGE_MOCK = 'true';
        await db.connect();
        await makeTenant('i-backup-a');
        await makeTenant('i-backup-b');
        const plain = mongoose.connection.collection('i_plain');
        await plain.deleteMany({});
        await plain.insertMany([
            { _id: new mongoose.Types.ObjectId(), at: new Date('2026-01-02T03:04:05Z'), i: new Int32(7), f: new Double(2.5), text: 'é ü\nnew line', nested: { a: [1, 2, { b: 3 }] } },
            { _id: new mongoose.Types.ObjectId(), text: 'second' },
            { _id: new mongoose.Types.ObjectId(), text: 'third' },
        ]);
        const idx = mongoose.connection.collection('i_idx');
        await idx.deleteMany({});
        await idx.createIndex({ u: 1 }, { unique: true });
        await idx.createIndex({ made: 1 }, { expireAfterSeconds: 3600 });
        await idx.insertOne({ u: 'one', made: new Date() });
        await mongoose.connection.collection('rl_i_counter').insertOne({ _id: 'k', points: 1 });
        tenantCount = await mongoose.connection.collection('tenants').countDocuments({});
        copy = mongoose.connection.client.db('i_restore_copy');
        await copy.dropDatabase();
    });
    after(async () => {
        await copy.dropDatabase();
        await fs.rm(ROOT, { recursive: true, force: true });
        await mongoose.connection.collection('i_plain').drop().catch(() => { });
        await mongoose.connection.collection('i_idx').drop().catch(() => { });
        await mongoose.connection.collection('rl_i_counter').drop().catch(() => { });
        await db.disconnect();
    });

    test('a backup has one file per collection and a manifest; counters, sessions and locks are left out', async () => {
        const r = await backups.createBackup({ now: WED });
        assert.deepEqual(r.targets, ['db-backups/daily/2026-10-14/']);
        const m = await manifestOf('daily/2026-10-14');
        const names = m.collections.map((c) => c.name);
        for (const n of ['i_plain', 'i_idx', 'tenants']) assert.ok(names.includes(n), n);
        for (const n of ['rl_i_counter', 'sessions', 'job_locks']) assert.ok(!names.includes(n), n);
        assert.equal(m.collections.find((c) => c.name === 'i_plain').count, 3);
        assert.ok(await store.exists(`db-backups/daily/2026-10-14/${m.collections[0].file}`));
        assert.deepEqual((await backups.listBackups()).daily, ['2026-10-14']);
    });

    test('on a Sunday (Indian time) the same backup is also kept as a weekly one', async () => {
        const r = await backups.createBackup({ now: SUN });
        assert.deepEqual(r.targets, ['db-backups/daily/2026-10-18/', 'db-backups/weekly/2026-W42/']);
        const l = await backups.listBackups();
        assert.ok(l.weekly.includes('2026-W42'));
        assert.deepEqual(await manifestOf('weekly/2026-W42'), await manifestOf('daily/2026-10-18'));
    });

    test('the restore test: a backup restored into an empty database gives back the same data, types and indexes', async () => {
        const r = await backups.restoreBackup({ db: copy, folder: 'daily/2026-10-18' });
        assert.ok(r.documents >= 4);
        assert.equal(await copy.collection('i_plain').countDocuments({}), 3);
        assert.equal(await copy.collection('tenants').countDocuments({}), tenantCount);

        const original = await mongoose.connection.collection('i_plain').find({ i: { $exists: true } }).next();
        const back = await copy.collection('i_plain').findOne({ _id: original._id });
        assert.equal(String(back._id), String(original._id));
        assert.equal(back.at.getTime(), original.at.getTime());
        assert.equal(back.text, 'é ü\nnew line');
        assert.deepEqual(back.nested, { a: [1, 2, { b: 3 }] });
        assert.equal(await copy.collection('i_plain').countDocuments({ i: { $type: 'int' } }), 1);       // int stays int
        assert.equal(await copy.collection('i_plain').countDocuments({ f: { $type: 'double' } }), 1);    // double stays double

        await assert.rejects(() => copy.collection('i_idx').insertOne({ u: 'one' }), (e) => e.code === 11000);   // unique index is back
        const ix = await copy.collection('i_idx').indexes();
        assert.equal(ix.find((x) => x.name === 'made_1').expireAfterSeconds, 3600);                             // TTL index is back
    });

    test('a restore refuses a database that has data, unless drop is given; bad and missing backups are refused', async () => {
        await assert.rejects(() => backups.restoreBackup({ db: copy, folder: 'daily/2026-10-18' }), /not empty/);
        const r = await backups.restoreBackup({ db: copy, folder: 'daily/2026-10-18', drop: true });
        assert.ok(r.documents >= 4);
        assert.equal(await copy.collection('i_plain').countDocuments({}), 3);       // replaced, not doubled
        await assert.rejects(() => backups.restoreBackup({ db: copy, folder: '../etc' }), /Folder must look like/);
        await assert.rejects(() => backups.restoreBackup({ db: copy, folder: 'daily/2020-01-01' }), /incomplete or does not exist/);
    });

    test('a folder without a manifest is not a backup', async () => {
        await store.putBuffer('db-backups/daily/2026-10-10/c0001.jsonl.gz', Buffer.from('half'));
        assert.ok(!(await backups.listBackups()).daily.includes('2026-10-10'));
        await assert.rejects(() => backups.restoreBackup({ db: copy, folder: 'daily/2026-10-10', drop: true }), /incomplete/);
    });

    test('only 7 daily and 4 weekly backups are kept, and foreign files are never touched', async () => {
        process.env.BACKUP_R2_PREFIX = 'db-ret';
        try {
            for (let i = 1; i <= 12; i += 1) await store.putBuffer(`db-ret/daily/2026-09-${String(i).padStart(2, '0')}/manifest.json`, Buffer.from('{}'));
            for (let i = 1; i <= 6; i += 1) await store.putBuffer(`db-ret/weekly/2026-W${String(i).padStart(2, '0')}/manifest.json`, Buffer.from('{}'));
            await store.putBuffer('db-ret/daily/notes/keep.txt', Buffer.from('x'));
            const removed = await backups.prune();
            assert.equal(removed.length, 5 + 2);
            const l = await backups.listBackups();
            assert.equal(l.daily.length, 7);
            assert.equal(l.daily[0], '2026-09-12');
            assert.equal(l.daily[6], '2026-09-06');
            assert.deepEqual(l.weekly, ['2026-W06', '2026-W05', '2026-W04', '2026-W03']);
            assert.ok(await store.exists('db-ret/daily/notes/keep.txt'));
        } finally {
            delete process.env.BACKUP_R2_PREFIX;
        }
    });
});

describe('I daily jobs', () => {
    before(() => db.connect());
    after(async () => {
        await mongoose.connection.collection('job_locks').deleteMany({ _id: /^i-/ });
        await db.disconnect();
    });

    test('a job waits for its hour, runs once a day, and a second server skips it', async () => {
        const fn = mock.fn(async () => 'ok');
        const job = { name: 'i-once', hour: 3, fn };
        const early = Date.parse('2026-10-14T02:59:00+05:30');
        const on = Date.parse('2026-10-14T03:00:00+05:30');
        assert.deepEqual(await runDailyOnce({ ...job, now: early }), { ran: false, reason: 'early' });
        assert.equal((await runDailyOnce({ ...job, now: on })).ran, true);
        assert.deepEqual(await runDailyOnce({ ...job, now: on + 3600000 }), { ran: false, reason: 'done' });
        assert.equal(fn.mock.calls.length, 1);
        assert.equal((await runDailyOnce({ ...job, now: on + 24 * 3600000 })).ran, true);        // next day runs again
    });

    test('a failed run lets the next check try again', async () => {
        let n = 0;
        const job = { name: 'i-retry', hour: 0, fn: async () => { n += 1; if (n === 1) throw new Error('disk full'); return 'ok'; } };
        const now = Date.parse('2026-10-14T04:00:00+05:30');
        await assert.rejects(() => runDailyOnce({ ...job, now }), /disk full/);
        assert.equal((await runDailyOnce({ ...job, now: now + 1800000 })).ran, true);
        assert.equal(n, 2);
    });
});

describe('I nightly wallet check', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('a wallet that matches its ledger is fine; a difference tells the superadmin once a day', async () => {
        const good = await makeTenant('i-rec-good');
        const bad = await makeTenant('i-rec-bad');
        const actor = { type: 'system' };
        for (const t of [good, bad]) await wallet.credit({ tenantId: t._id, amountPaise: 5000, type: 'adjust', note: 't', actor });
        await SmsWallet.updateOne({ tenantId: bad._id }, { $inc: { balancePaise: 50 } });      // money without a ledger row

        const r = await runNightlyReconcile();
        assert.ok(r.checked >= 2);
        assert.ok(r.mismatched >= 1);
        const rows = await Notification.find({ role: 'superadmin', type: 'admin_wallet_mismatch', tenantId: bad._id }).lean();
        assert.equal(rows.length, 1);
        assert.match(rows[0].body, /difference Rs 0\.50/);
        assert.equal(await Notification.countDocuments({ role: 'superadmin', type: 'admin_wallet_mismatch', tenantId: good._id }), 0);

        await runNightlyReconcile();                                                           // same night again
        assert.equal(await Notification.countDocuments({ role: 'superadmin', type: 'admin_wallet_mismatch', tenantId: bad._id }), 1);
    });

    test('a shop whose wallet is right is never reported, even after credits and a debit', async () => {
        const t = await makeTenant('i-rec-ok');
        const actor = { type: 'system' };
        await wallet.credit({ tenantId: t._id, amountPaise: 3000, type: 'adjust', note: 't', actor });
        await wallet.manualDebit({ tenantId: t._id, amountPaise: 1000, note: 't', actor });
        assert.equal((await wallet.reconcileWallet(t._id)).differencePaise, 0);
        await runNightlyReconcile();
        assert.equal(await Notification.countDocuments({ role: 'superadmin', type: 'admin_wallet_mismatch', tenantId: t._id }), 0);
    });
});