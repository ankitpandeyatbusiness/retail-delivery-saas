// Creates the first superadmin (no password needed) or changes the login phones of an existing one.
//   node scripts/setSuperAdminPhones.js you@example.com 9876543210 [9123456780]
// The email is only a label. Run it from the backend folder.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/database/database');
const SuperAdmin = require('../src/models/SuperAdmin');

(async () => {
    const [email, ...phones] = process.argv.slice(2);
    const list = [...new Set(phones)];
    if (!email || !list.length || list.length > 2 || !list.every((p) => /^[6-9]\d{9}$/.test(p))) {
        console.error('Usage: node scripts/setSuperAdminPhones.js <email> <phone1> [phone2]   (10-digit mobile numbers, at most 2)');
        process.exit(1);
    }

    await connectDB();
    const key = email.trim().toLowerCase();
    const clash = await SuperAdmin.findOne({ email: { $ne: key }, phones: { $in: list } }).select('email').lean();
    if (clash) {
        console.error(`A number is already used by ${clash.email}.`);
        process.exit(1);
    }
    const existing = await SuperAdmin.findOne({ email: key });
    const account = existing || new SuperAdmin({ email: key });
    account.isActive = true;
    account.phones = list;
    await account.save();

    console.log(`${existing ? 'Phones updated' : 'Superadmin created'}: ${key} -> ${list.join(', ')}`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });