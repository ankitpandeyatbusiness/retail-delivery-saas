// Sets how a shop's customer app LOOKS, without opening the superadmin panel.
// It changes only these keys of settings.brand (everything else the shop has is kept):
//   look, headerStyle, categoryStyle, tabBarStyle, motion, fontStyle, buttonShape, and colors.accent
//
//   node scripts/setLook.js savera                       the premium preset (fresh, photo tiles, floating tabs)
//   node scripts/setLook.js savera look=midnight accent=#FFB020 categoryStyle=pills
//   node scripts/setLook.js savera --reset               back to the original look (removes the keys above)
//
// Run it from the backend folder. It prints the old and the new brand settings, so a change is easy to undo.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/database/database');
const Tenant = require('../src/models/Tenant');
const O = require('../src/config/tenantOptions');
const { validateSettings } = require('../src/services/tenantConfigService');

const KEYS = ['look', 'headerStyle', 'categoryStyle', 'tabBarStyle', 'motion', 'fontStyle', 'buttonShape'];
const PREMIUM = { look: 'fresh', headerStyle: 'hero', categoryStyle: 'tiles', tabBarStyle: 'floating', motion: 'full', accent: '#F59E0B' };

(async () => {
    const [slug, ...rest] = process.argv.slice(2);
    if (!slug) {
        console.error('Usage: node scripts/setLook.js <shop-slug> [key=value ...] | --reset');
        console.error('Keys: look, headerStyle, categoryStyle, tabBarStyle, motion, fontStyle, buttonShape, accent');
        console.error('Values: look=' + O.LOOKS.join('|') + '  categoryStyle=' + O.CATEGORY_STYLES.join('|') + '  tabBarStyle=' + O.TAB_BAR_STYLES.join('|'));
        process.exit(1);
    }
    const reset = rest.includes('--reset');
    const given = Object.fromEntries(rest.filter((a) => a.includes('=')).map((a) => a.split('=')));
    const want = reset ? {} : (Object.keys(given).length ? given : PREMIUM);

    await connectDB();
    const t = await Tenant.findOne({ slug: slug.toLowerCase() });
    if (!t) { console.error(`No shop with slug "${slug}".`); process.exit(1); }

    const settings = JSON.parse(JSON.stringify(t.settings || {}));
    const before = JSON.parse(JSON.stringify(settings.brand || {}));
    const brand = { ...before };
    const colors = { ...(brand.colors || {}) };

    if (reset) {
        [...KEYS].forEach((k) => delete brand[k]);
        delete colors.accent;
    } else {
        for (const [k, v] of Object.entries(want)) {
            if (k === 'accent') colors.accent = v;
            else if (KEYS.includes(k)) brand[k] = v;
            else { console.error(`Unknown key "${k}".`); process.exit(1); }
        }
    }
    if (Object.keys(colors).length) brand.colors = colors; else delete brand.colors;
    if (Object.keys(brand).length) settings.brand = brand; else delete settings.brand;

    // the same check the superadmin panel and the model hook use
    const { ok, errors } = validateSettings(settings);
    if (!ok) { console.error('Not saved. Problems:\n - ' + errors.join('\n - ')); process.exit(1); }

    t.settings = settings;
    t.markModified('settings');
    await t.save();

    console.log(`Shop: ${t.name} (${t.slug})`);
    console.log('Before:', JSON.stringify(before));
    console.log('After: ', JSON.stringify(settings.brand || {}));
    console.log('The running backend caches a shop for up to 1 minute. After that, fully close and reopen the app.');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
