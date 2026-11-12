// Builds (or rebuilds) the public demo shop: node src/scripts/seedDemoPublic.js   (npm run seed:demo)
// Wipes ONLY the demo shop's content (slug "demo" and its two branches); every other shop is untouched.
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('Set MONGO_URI (or MONGODB_URI) in your .env');
    await mongoose.connect(uri);
    const r = await require('../services/demoSeed').seed();
    console.log(`Demo shop ready: ${r.products} dishes in ${r.categories} categories. Restart the backend once so it drops cached shops.`);
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
