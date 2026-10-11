// Adds the phone hash to OLD users and orders (new ones get it by themselves).
//   node scripts/backfillPhoneHash.js            -> dry run, only counts
//   node scripts/backfillPhoneHash.js --apply    -> writes it
// Safe to run twice. Run it ONCE before you use the new code on real data.
if (require.main === module) require('dotenv').config();

const User = require('../src/models/User');
const Order = require('../src/models/Order');
const { hashPhone } = require('../src/utils/phoneHash');

const PAGE = 500;
const validPhone = (p) => /^\d{10}$/.test(String(p || ''));

async function run(Model, filter, select, phoneOf, apply) {
    let count = 0;
    let lastId = null;
    for (; ;) {
        const rows = await Model.find({ ...filter, ...(lastId && { _id: { $gt: lastId } }) })
            .sort({ _id: 1 }).limit(PAGE).select(select).lean();
        if (!rows.length) break;
        lastId = rows[rows.length - 1]._id;
        const ops = rows.filter((r) => validPhone(phoneOf(r))).map((r) => ({
            updateOne: {
                filter: { _id: r._id },
                update: { $set: { [Model === User ? 'phoneHash' : 'customer.phoneHash']: hashPhone(r.tenantId, phoneOf(r)) } },
            },
        }));
        count += ops.length;
        // timestamps: false keeps every updatedAt as it was
        if (apply && ops.length) await Model.bulkWrite(ops, { ordered: false, timestamps: false });
        if (rows.length < PAGE) break;
    }
    return count;
}

async function backfill({ apply = false } = {}) {
    const users = await run(User, { phoneHash: { $exists: false } }, 'tenantId phone', (u) => u.phone, apply);
    const orders = await run(
        Order,
        { 'customer.phone': { $exists: true }, 'customer.phoneHash': { $exists: false } },
        'tenantId customer.phone',
        (o) => o.customer?.phone,
        apply,
    );
    return { users, orders };
}

module.exports = { backfill };

if (require.main === module) {
    const mongoose = require('mongoose');
    const connectDB = require('../src/database/database');
    const apply = process.argv.includes('--apply');
    (async () => {
        await connectDB();
        const r = await backfill({ apply });
        console.log(`${apply ? 'Updated' : 'Would update'}: ${r.users} user(s), ${r.orders} order(s).`);
        if (!apply) console.log('Run again with --apply to save.');
        await mongoose.disconnect();
        process.exit(0);
    })().catch((e) => { console.error(e); process.exit(1); });
}