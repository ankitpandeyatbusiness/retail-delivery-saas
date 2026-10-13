// List the backups, or restore one into a database you choose.
//   node scripts/restoreBackup.js list
//   node scripts/restoreBackup.js restore daily/2026-10-14 --uri="mongodb+srv://.../restorecheck"
//   add --drop to replace collections that already have data
// Restore into an EMPTY test database first and look at it. The live database is refused unless you add --production.
require('dotenv').config();
const mongoose = require('mongoose');
const backups = require('../src/services/backupService');

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

(async () => {
    const cmd = args[0];
    if (cmd === 'list') {
        console.log(JSON.stringify(await backups.listBackups(), null, 2));
        return;
    }
    if (cmd !== 'restore' || !args[1]) {
        console.log('Usage: node scripts/restoreBackup.js list | restore <daily/YYYY-MM-DD|weekly/YYYY-Www> --uri="..." [--drop] [--production]');
        process.exit(1);
    }
    const uri = flag('uri');
    if (!uri) throw new Error('--uri is required: the database to restore INTO');
    const live = [process.env.MONGODB_URI, process.env.MONGO_URI, process.env.DATABASE_URL, process.env.MONGO_URL].filter(Boolean);
    if (live.includes(uri) && !args.includes('--production')) {
        throw new Error('That is the live database. Restore into a test database, or add --production if you really mean it.');
    }
    const conn = await mongoose.createConnection(uri).asPromise();
    try {
        const r = await backups.restoreBackup({ db: conn.db, folder: args[1], drop: args.includes('--drop') });
        console.log(`Restored ${r.documents} documents in ${r.collections} collections (backup made ${r.createdAt}).`);
    } finally {
        await conn.close();
    }
})().then(() => process.exit(0)).catch((e) => { console.error('Restore failed:', e.message); process.exit(1); });