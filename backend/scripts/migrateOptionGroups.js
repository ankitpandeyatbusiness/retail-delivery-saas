// Converts old sizes / weightOptions / addOns into optionGroups.
//   node scripts/migrateOptionGroups.js            -> dry run, only prints what would change
//   node scripts/migrateOptionGroups.js --apply    -> writes the changes
// Safe to run twice: products that already have optionGroups are skipped.
// The old fields are NOT deleted.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../database/database');
const Product = require('../models/Product');
const { validateOptionGroups } = require('../services/optionGroups');

const APPLY = process.argv.includes('--apply');

const slug = (s, fallback) =>
    String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26) || fallback;

// unique ids inside one group
const makeIds = (names) => {
    const seen = new Set();
    return names.map((n, i) => {
        const base = slug(n, `o${i + 1}`);
        let id = base;
        let k = 2;
        while (seen.has(id)) id = `${base}-${k++}`;
        seen.add(id);
        return id;
    });
};

const grams = (g) => (g >= 1000 && g % 1000 === 0 ? `${g / 1000}kg` : `${g}g`);

// Old size/weight prices were full prices; option prices are extras on top of the base price.
function priceGroup({ id, name, entries, base }) {
    const rows = entries.slice(0, 30);
    const ids = makeIds(rows.map((r) => r.name));
    const extras = rows.map((r) => Math.max(0, (Number(r.price) || 0) - base));
    const cheapest = extras.indexOf(Math.min(...extras));
    return {
        id, name, min: 1, max: 1,
        options: rows.map((r, i) => ({ id: ids[i], name: r.name, price: extras[i], isDefault: i === cheapest, isAvailable: true })),
    };
}

function buildGroups(p) {
    const groups = [];
    if (p.sizes?.length) {
        groups.push(priceGroup({
            id: 'size', name: 'Choose size', base: p.price,
            entries: p.sizes.map((s) => ({ name: s.label || 'Regular', price: s.price })),
        }));
    }
    if (p.weightOptions?.length) {
        groups.push(priceGroup({
            id: 'weight', name: 'Choose weight', base: p.price,
            entries: p.weightOptions.map((w) => ({ name: grams(w.grams), price: w.price })),
        }));
    }
    if (p.addOns?.length) {
        const rows = p.addOns.slice(0, 30);
        const ids = makeIds(rows.map((a) => a.name));
        groups.push({
            id: 'extras', name: 'Add extras', min: 0, max: rows.length,
            options: rows.map((a, i) => ({ id: ids[i], name: a.name || `Extra ${i + 1}`, price: Math.max(0, Number(a.price) || 0), isDefault: false, isAvailable: true })),
        });
    }
    return groups;
}

(async () => {
    await connectDB();
    const products = await Product.find({}).lean();
    const ops = [];
    let skipped = 0;
    let invalid = 0;

    for (const p of products) {
        if (p.optionGroups?.length) { skipped++; continue; }
        const groups = buildGroups(p);
        if (!groups.length) continue;
        const errors = validateOptionGroups(groups);
        if (errors.length) {
            invalid++;
            console.warn(`SKIP "${p.name}" (${p._id}): ${errors.join('; ')}`);
            continue;
        }
        console.log(`${APPLY ? 'MIGRATE' : 'WOULD MIGRATE'} "${p.name}": ${groups.map((g) => `${g.name} (${g.options.length})`).join(', ')}`);
        ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { optionGroups: groups } } } });
    }

    if (APPLY && ops.length) await Product.bulkWrite(ops);
    console.log(`\n${ops.length} product(s) ${APPLY ? 'migrated' : 'would be migrated'}, ${skipped} already done, ${invalid} skipped as invalid.`);
    if (!APPLY && ops.length) console.log('Run again with --apply to save.');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });