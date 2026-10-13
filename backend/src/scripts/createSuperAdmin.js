// Creates (or updates) a platform superadmin. There is no public sign-up route on purpose.
// Superadmins log in with phone OTP only, so no password is set here.
//   node src/scripts/createSuperAdmin.js you@example.com "Your Name" --phone 9876543210 [--phone 9123456780]
// --phone is the OTP login phone (max 2, repeat the flag or use commas). Re-running with an existing email replaces its phones.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const SuperAdmin = require('../models/SuperAdmin');

const PHONE_RE = /^[6-9]\d{9}$/;

// Splits argv into plain arguments and --phone values (--phone 98..., --phone=98..., or comma-separated)
function parseArgs(argv) {
    const args = [];
    const phones = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--phone') phones.push(...String(argv[++i] || '').split(','));
        else if (a.startsWith('--phone=')) phones.push(...a.slice('--phone='.length).split(','));
        else args.push(a);
    }
    return { args, phones: [...new Set(phones.map((p) => p.trim()).filter(Boolean))] };
}

(async () => {
    const { args: [email, name], phones } = parseArgs(process.argv.slice(2));
    if (!email || !phones.length) {
        console.error('Usage: node src/scripts/createSuperAdmin.js <email> [name] --phone <10-digit> [--phone <10-digit>]');
        process.exit(1);
    }
    if (phones.length > 2) {
        console.error('At most 2 phones are allowed.');
        process.exit(1);
    }
    if (!phones.every((p) => PHONE_RE.test(p))) {
        console.error('Phones must be 10-digit mobile numbers (starting 6-9), without +91.');
        process.exit(1);
    }

    await connectDB();
    const key = email.trim().toLowerCase();

    // A phone can belong to one admin only, otherwise OTP login would not know whose it is
    if (await SuperAdmin.exists({ email: { $ne: key }, phones: { $in: phones } })) {
        console.error('One of these phones already belongs to another superadmin.');
        await mongoose.disconnect();
        process.exit(1);
    }

    const existing = await SuperAdmin.findOne({ email: key });
    const account = existing || new SuperAdmin({ email: key });
    if (name) account.name = name;
    account.phones = phones;
    account.isActive = true;
    await account.save();

    console.log(`${existing ? 'Superadmin updated' : 'Superadmin created'}: ${key} (phones: ${account.phones.join(', ')})`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
