require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/database/database');
const { runBackup } = require('../src/jobs/backupDump');

(async () => {
    await connectDB();
    const r = await runBackup();
    console.log(JSON.stringify(r, null, 2));
    await mongoose.connection.close();
    process.exit(0);
})().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });