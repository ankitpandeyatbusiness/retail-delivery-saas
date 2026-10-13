// Daily database backup at 02:00 Indian time, to the PRIVATE backup bucket. See services/backupService.js.
// Env: BACKUP_R2_BUCKET (private), BACKUP_R2_PREFIX (default db-backups), optional BACKUP_SKIP=collection1,collection2
const mongoose = require('mongoose');
const backups = require('../services/backupService');
const store = require('../services/adapters/backupStorage');
const { startDailyJob } = require('../utils/dailyJob');

async function runBackup(opts = {}) {
    const r = await backups.createBackup({ db: mongoose.connection.db, ...opts });
    console.log(`DB backup done: ${r.day}, ${r.collections} collections, ${r.documents} documents, ${Math.round(r.bytes / 1024)} KB` +
        (r.pruned.length ? `, removed old: ${r.pruned.join(', ')}` : ''));
    return r;
}

function startBackupScheduler() {
    if (process.env.STORAGE_MOCK === 'true') return;                 // development: use "npm run backup"
    if (!store.configured()) {
        console.warn('DB backup is NOT configured (set BACKUP_R2_BUCKET). No backups will be made.');
        return;
    }
    startDailyJob({ name: 'db-backup', hour: 2, fn: runBackup });
}

module.exports = { runBackup, startBackupScheduler };