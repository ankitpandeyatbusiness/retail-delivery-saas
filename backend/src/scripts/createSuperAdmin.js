// Creates (or resets the password of) a platform superadmin. There is no public sign-up route on purpose.
//   node scripts/createSuperAdmin.js you@example.com "a-long-password" "Your Name"
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const SuperAdmin = require('../models/SuperAdmin');

(async () => {
    const [email, password, name] = process.argv.slice(2);
    if (!email || !password) {
        console.error('Usage: node scripts/createSuperAdmin.js <email> <password> [name]');
        process.exit(1);
    }
    if (password.length < 10) {
        console.error('Password must be at least 10 characters.');
        process.exit(1);
    }

    await connectDB();
    const key = email.trim().toLowerCase();
    const existing = await SuperAdmin.findOne({ email: key });
    const account = existing || new SuperAdmin({ email: key });
    if (name) account.name = name;
    account.isActive = true;
    await account.setPassword(password);
    await account.save();

    console.log(existing ? `Password reset for ${key}` : `Superadmin created: ${key}`);
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });