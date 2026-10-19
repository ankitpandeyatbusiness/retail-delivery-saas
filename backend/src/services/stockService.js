// Stock: Product.stock = { enabled, qty }. Taking stock is ONE atomic step per product, so two orders
// can never take the last unit. At 0 the product is switched off (isAvailable false).
const Product = require('../models/Product');
const { httpError } = require('../middlewares/apiErrors');

// order lines -> [{ productId, qty }] (one entry per product)
function sumItems(items = []) {
    const m = new Map();
    for (const l of items) {
        const k = String(l.productId);
        m.set(k, { productId: l.productId, qty: (m.get(k)?.qty || 0) + l.quantity });
    }
    return [...m.values()];
}

// The shop day: Indian time, and it turns over at 4 in the morning so a shop open past midnight keeps one day.
const DAY_START_HOUR = 4;
const dayKey = (now = new Date()) => new Date(now.getTime() + (330 - DAY_START_HOUR * 60) * 60000).toISOString().slice(0, 10);

// Items with a daily quantity start each shop day with it again. Done lazily: the first request of a new day for
// a shop does it (one update, remembered per shop), so no night job can be missed.
const doneFor = new Map();   // tenantId -> shop day already refreshed
// Items the owner switched off "until 3 PM" / "until tomorrow morning" come back when that time has passed. Done lazily too
// (whenever the menu is read, at most every 20 seconds per shop), so no job has to run at that moment.
// An item that counts its stock and has none left stays off.
const sweptAt = new Map();   // tenantId -> when we last looked
async function sweepSoldOut(tenantId, now = new Date(), { force = false } = {}) {
    const k = String(tenantId);
    if (!force && now.getTime() - (sweptAt.get(k) || 0) < 20000) return;
    sweptAt.set(k, now.getTime());
    await Product.updateMany(
        { tenantId, unavailableUntil: { $lte: now } },
        [
            { $set: { isAvailable: { $cond: [{ $and: [{ $eq: ['$stock.enabled', true] }, { $lte: [{ $ifNull: ['$stock.qty', 0] }, 0] }] }, false, true] } } },
            { $unset: 'unavailableUntil' },
        ],
        { updatePipeline: true },
    );
    await sweepPortions(tenantId, now).catch(() => { });
}

// A portion (Half / Full) that was switched off "for a while" comes back when its time is over. Same 20 s rhythm as the items.
async function sweepPortions(tenantId, now) {
    const due = await Product.find({ tenantId, 'optionGroups.options.unavailableUntil': { $lte: now } }).select('optionGroups isAvailable unavailableUntil');
    for (const p of due) {
        for (const g of p.optionGroups) {
            const hadOne = g.options.some((x) => x.isAvailable !== false);
            let back = false;
            for (const o of g.options) {
                if (o.unavailableUntil && o.unavailableUntil <= now) { o.isAvailable = true; o.unavailableUntil = undefined; back = true; }
            }
            // the item was sold out only because no portion was left: it is back with the first portion
            if (back && !hadOne && (g.min || 0) >= 1 && !p.unavailableUntil) p.isAvailable = true;
        }
        p.markModified('optionGroups');
        await p.save().catch(() => { });
    }
}

async function ensureToday(tenantId, now = new Date()) {
    await sweepSoldOut(tenantId, now);
    const today = dayKey(now);
    const k = String(tenantId);
    if (doneFor.get(k) === today) return;
    await Product.updateMany(
        { tenantId, 'stock.enabled': true, 'stock.dailyQty': { $gt: -1 }, 'stock.resetOn': { $ne: today } },
        [{ $set: { 'stock.qty': '$stock.dailyQty', 'stock.resetOn': today, isAvailable: { $gt: ['$stock.dailyQty', 0] } } }],
        { updatePipeline: true },
    );
    doneFor.set(k, today);
}

// give units back. A product that was at 0 is switched on again.
async function restore(tenantId, needs = []) {
    for (const n of needs) {
        const after = await Product.findOneAndUpdate(
            { _id: n.productId, tenantId, 'stock.enabled': true },
            { $inc: { 'stock.qty': n.qty } },
            { returnDocument: 'after' },
        ).select('stock.qty').lean();
        if (after && after.stock.qty === n.qty) {
            await Product.updateOne({ _id: n.productId, tenantId, 'stock.enabled': true }, { $set: { isAvailable: true } });
        }
    }
}

// needs: [{ productId, name, qty }] of the tracked products. Throws 409 when one of them is short.
async function reserve(tenantId, needs = []) {
    const done = [];
    for (const n of needs) {
        const r = await Product.updateOne(
            { _id: n.productId, tenantId, 'stock.enabled': true, 'stock.qty': { $gte: n.qty } },
            { $inc: { 'stock.qty': -n.qty } },
        );
        if (!r.modifiedCount) {
            await restore(tenantId, done).catch(() => { });
            const cur = await Product.findOne({ _id: n.productId, tenantId }).select('stock').lean();
            const left = cur?.stock?.enabled ? cur.stock.qty : 0;
            // never the real number: customers only learn that there is not enough
            throw httpError(409, left > 0 ? `There is not enough "${n.name}" left. Please order a little less.` : `"${n.name}" is out of stock`);
        }
        done.push(n);
        await Product.updateOne({ _id: n.productId, tenantId, 'stock.enabled': true, 'stock.qty': 0 }, { $set: { isAvailable: false } });
    }
    return done;
}

const restoreForOrder = (order) => restore(order.tenantId, sumItems(order.items));

module.exports = { sumItems, reserve, restore, restoreForOrder, dayKey, ensureToday, sweepSoldOut };