// One quotable reference for every document a customer or a shop can talk about, unique across ALL shops:
//   order          SAV-1042        (the shop's code + its order number)
//   bulk order     SAV-BK-9F3A21   (the shop's code + the bulk code)
//   table booking  SAV-TB-K7M2QX   (the shop's code + the booking code)
//   SMS top-up     SAV-T7          (the shop's code + its own count of top-ups)
//   table bill     SAV-B12         (the shop's code + its own count of table bills)
// The shop code is 2 to 6 letters or digits, made once from the shop's name and never changed.
// These are NOT tax invoice numbers: the legal numbers (INV-1042, SUB/..., TOP/..., CN/...) stay exactly as they were.
const mongoose = require('mongoose');

const KINDS = ['order', 'bulk', 'booking', 'topup', 'table'];
const cache = new Map();   // tenantId -> shop code

const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim();

// the codes to try for a shop, nicest first: SAV, SAVE, SAVER, then the initials
function candidates(name, slug) {
    const words = clean(name).split(/\s+/).filter(Boolean);
    const letters = words.join('').replace(/[^A-Z]/g, '') || clean(slug).replace(/[^A-Z0-9]/g, '') || 'SHOP';
    const out = [3, 4, 5].map((n) => letters.slice(0, n));
    const initials = words.map((w) => w[0]).join('').replace(/[^A-Z0-9]/g, '');
    if (initials.length >= 3) out.push(initials.slice(0, 5));
    return [...new Set(out.filter((c) => c.length >= 2))];
}

async function generate(name, slug) {
    const Tenant = mongoose.model('Tenant');
    const tries = candidates(name, slug);
    for (const c of tries) if (!(await Tenant.exists({ refCode: c }))) return c;
    const base = (tries[0] || 'SHP').slice(0, 3);
    for (let i = 2; i < 1000; i += 1) {
        const c = `${base}${i}`.slice(0, 6);
        if (!(await Tenant.exists({ refCode: c }))) return c;
    }
    throw new Error('No free shop code');
}

// the shop's code, made and saved now if the shop has none yet
async function codeOf(tenantId) {
    const key = String(tenantId);
    if (cache.has(key)) return cache.get(key);
    const Tenant = mongoose.model('Tenant');
    const t = await Tenant.findById(tenantId).select('refCode name slug').lean();
    if (!t) return 'SHP';
    let code = t.refCode;
    if (!code) {
        code = await generate(t.name, t.slug);
        const r = await Tenant.updateOne({ _id: tenantId, refCode: { $exists: false } }, { $set: { refCode: code } });
        if (!r.modifiedCount) code = (await Tenant.findById(tenantId).select('refCode').lean())?.refCode || code;   // another call was faster
    }
    cache.set(key, code);
    return code;
}

// the next number of a kind for one shop (SMS top-ups and table bills count per shop)
async function seq(tenantId, letter) {
    const Counter = mongoose.model('Counter');
    const c = await Counter.findOneAndUpdate({ _id: `ref:${tenantId}:${letter}` }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
    return c.seq;
}

async function refFor(kind, doc) {
    const code = await codeOf(doc.tenantId);
    switch (kind) {
        case 'order': return `${code}-${doc.orderNo}`;
        case 'bulk': return `${code}-BK-${doc.code}`;
        case 'booking': return `${code}-TB-${doc.code}`;
        case 'topup': return `${code}-T${await seq(doc.tenantId, 'T')}`;
        case 'table': return `${code}-B${await seq(doc.tenantId, 'B')}`;
        default: throw new Error('Unknown reference kind');
    }
}

const MODEL = { order: 'Order', bulk: 'BulkOrder', booking: 'TableBooking', topup: 'SmsTopup', table: 'TableSession' };

// Gives every shop a code and every old document its reference. Safe to run again and again (it only fills what is missing).
async function backfillAll() {
    const Tenant = mongoose.model('Tenant');
    const Counter = mongoose.model('Counter');
    const out = { shops: 0, order: 0, bulk: 0, booking: 0, topup: 0, table: 0 };
    const shops = await Tenant.find({}).select('_id refCode').lean();
    for (const s of shops) {
        if (!s.refCode) { await codeOf(s._id); out.shops += 1; }
    }
    const withCodes = await Tenant.find({ refCode: { $type: 'string' } }).select('_id refCode').lean();
    for (const t of withCodes) {
        const code = t.refCode;
        const where = (extra = {}) => ({ tenantId: t._id, ref: { $exists: false }, ...extra });
        // orders, bulk orders, bookings: one update, built from fields they already have
        const upd = async (kind, expr, extra) => {
            const Model = mongoose.model(MODEL[kind]);
            const r = await Model.collection.updateMany(where(extra), [{ $set: { ref: expr } }]);
            out[kind] += r.modifiedCount || 0;
        };
        await upd('order', { $concat: [code, '-', { $toString: '$orderNo' }] });
        await upd('bulk', { $concat: [code, '-BK-', '$code'] }, { code: { $type: 'string' } });
        await upd('booking', { $concat: [code, '-TB-', '$code'] }, { code: { $type: 'string' } });
        // top-ups and table bills: counted in the order they were made
        for (const [kind, letter] of [['topup', 'T'], ['table', 'B']]) {
            const Model = mongoose.model(MODEL[kind]);
            const todo = await Model.find(where()).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
            if (!todo.length) continue;
            const counterId = `ref:${t._id}:${letter}`;
            let n = (await Counter.findById(counterId).lean())?.seq || 0;
            const ops = todo.map((d) => { n += 1; return { updateOne: { filter: { _id: d._id, ref: { $exists: false } }, update: { $set: { ref: `${code}-${letter}${n}` } } } }; });
            await Model.collection.bulkWrite(ops, { ordered: false });
            await Counter.updateOne({ _id: counterId }, { $max: { seq: n } }, { upsert: true });
            out[kind] += todo.length;
        }
    }
    return out;
}

const REF_RX = /^([A-Z0-9]{2,6})-([A-Z0-9-]{1,20})$/;
const looksLikeRef = (q) => REF_RX.test(String(q || '').trim().toUpperCase());

// "SAV-1042" -> what it is and where it lives: { kind, model, ref, tenantId, docs: [...] } or null. Nothing is changed.
async function resolve(q) {
    const ref = String(q || '').trim().toUpperCase();
    const m = REF_RX.exec(ref);
    if (!m) return null;
    const Tenant = mongoose.model('Tenant');
    const shop = await Tenant.findOne({ refCode: m[1] }).select('_id name').lean();
    if (!shop) return null;
    const rest = m[2];
    const kind = /^\d+$/.test(rest) ? 'order' : /^T\d+$/.test(rest) ? 'topup' : /^B\d+$/.test(rest) ? 'table' : /^BK-/.test(rest) ? 'bulk' : /^TB-/.test(rest) ? 'booking' : null;
    if (!kind) return null;
    const Model = mongoose.model(MODEL[kind]);
    const docs = await Model.find({ ref, tenantId: shop._id }).limit(5).lean();
    if (!docs.length) return null;
    return { kind, ref, tenantId: String(shop._id), shop: shop.name, docs };
}

module.exports = { KINDS, MODEL, generate, candidates, codeOf, seq, refFor, backfillAll, resolve, looksLikeRef };
