// Several orders of different kinds at once (delivery, pickup, dine in). The shop is protected with three rules, each one the owner's choice:
//   dineBlocksOthers  while a table bill of his is open, he cannot order delivery or pickup (he cannot be at the table and elsewhere)
//   deliveryOpenMax   how many delivery orders he can have on the way at a time (pickup has its own number in pickupRules)
//   exposure          everything he owes in CASH at the same time (open table bill + cash delivery / pickup orders not yet paid + this order)
//                     stays under a limit: lower for a new customer, higher for a trusted one (a few earlier completed orders)
// Returns { status, message } when the order must not go through, otherwise null.
const Order = require('../models/Order');
const TableSession = require('../models/TableSession');
const { DEFAULTS } = require('./tenantConfigService');
const { HIDE_UNPAID } = require('./onlineOrder');

const OPEN = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];
const rupees = (n) => Math.round(n);

async function check({ tenant, config, userId, priced, body }) {
    const rules = { ...DEFAULTS.orders.mixRules, ...(config.orders.mixRules || {}) };
    const type = priced.orderType;
    const tenantId = tenant._id;

    // 1. a table bill is open: no delivery or pickup until it is paid
    if (type !== 'dine_in' && rules.dineBlocksOthers) {
        const s = await TableSession.findOne({ tenantId, customers: userId, status: { $in: ['open', 'bill_asked'] } }).select('table').lean();
        if (s) return { status: 409, message: `You are dining at table ${s.table}. Please pay your table bill first, then you can order ${type === 'delivery' ? 'delivery' : 'pickup'}.` };
    }

    // 2. too many deliveries on the way
    if (type === 'delivery' && rules.deliveryOpenMax > 0) {
        const n = await Order.countDocuments({ tenantId, userId, orderType: 'delivery', status: { $in: OPEN }, ...HIDE_UNPAID });
        if (n >= rules.deliveryOpenMax) return { status: 409, message: `You already have ${n} delivery order${n === 1 ? '' : 's'} on the way. You can order again after one is delivered.` };
    }

    // 3. all the cash he owes at the same time
    if (rules.exposureOn && body.paymentMethod === 'cod') {
        const tableBill = require('./tableBill');
        const [cashOrders, session, done] = await Promise.all([
            Order.find({ tenantId, userId, orderType: { $in: ['delivery', 'pickup'] }, 'payment.method': 'cod', 'payment.status': { $ne: 'paid' }, status: { $in: OPEN }, ...HIDE_UNPAID }).select('pricing.total').lean(),
            tableBill.openFor(tenantId, userId),
            Order.countDocuments({ tenantId, userId, status: 'delivered' }),
        ]);
        const tab = session ? (await tableBill.billOf(session)).due || 0 : 0;
        const owing = cashOrders.reduce((n, o) => n + (o.pricing?.total || 0), 0) + tab + priced.pricing.total;
        const trusted = done >= rules.regularAfter;
        const limit = trusted ? rules.exposureTrusted : rules.exposureNew;
        if (limit > 0 && owing > limit) {
            return { status: 409, message: `Your cash orders and table bill together would be ₹${rupees(owing)}, above the ₹${limit} limit. Please pay this order online, or finish the earlier ones first.` };
        }
    }
    return null;
}

module.exports = { check };
