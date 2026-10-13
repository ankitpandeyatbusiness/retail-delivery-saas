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
            throw httpError(409, left > 0 ? `Only ${left} left of "${n.name}"` : `"${n.name}" is out of stock`);
        }
        done.push(n);
        await Product.updateOne({ _id: n.productId, tenantId, 'stock.enabled': true, 'stock.qty': 0 }, { $set: { isAvailable: false } });
    }
    return done;
}

const restoreForOrder = (order) => restore(order.tenantId, sumItems(order.items));

module.exports = { sumItems, reserve, restore, restoreForOrder };