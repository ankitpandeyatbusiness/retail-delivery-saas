// What the shop really kept over a period: delivered sales, minus what the owner wrote as costs, minus the rent and SMS top-ups paid to the platform.
// Sales are counted like the closing report (delivered orders on the day they were delivered, after discounts). All amounts in rupees unless named ...Paise.
// A repeating cost (a salary, the shop rent) counts a share for each day of the period it is active: amount / days of that month.
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
const ShopExpense = require('../models/ShopExpense');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsTopup = require('../models/SmsTopup');
const { httpError } = require('../middlewares/apiErrors');

const IST_MS = 330 * 60000;
const DAY = 86400000;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const LABEL = {
    ingredients: 'Ingredients and stock', salaries: 'Salaries', shop_rent: 'Shop rent', electricity_gas: 'Electricity, gas and water', packaging: 'Packaging',
    marketing: 'Marketing', repairs: 'Repairs', transport: 'Transport', other: 'Other',
};
const NET = { $subtract: [{ $add: [{ $ifNull: ['$pricing.subtotal', 0] }, { $ifNull: ['$pricing.packagingCharge', 0] }] }, { $ifNull: ['$pricing.discount', 0] }] };
const okDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const istStart = (day) => new Date(Date.parse(`${day}T00:00:00+05:30`));
const todayIst = (now = new Date()) => new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);

// how many rupees of one repeating cost fall inside [from, to) : a share for every active day
function repeatShare(e, from, to) {
    const start = Math.max(from.getTime(), new Date(e.date).getTime());
    const end = Math.min(to.getTime(), e.endsOn ? new Date(e.endsOn).getTime() + DAY : to.getTime());
    if (end <= start) return 0;
    let paise = 0;
    for (let t = start; t < end; t += DAY) {
        const d = new Date(t + IST_MS);
        const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        paise += e.amountPaise / dim;
    }
    return paise;
}

async function build({ tenantId, from: fromDay, to: toDay, now = new Date() }) {
    const f = fromDay === undefined ? todayIst(now).slice(0, 8) + '01' : fromDay;
    const t = toDay === undefined ? todayIst(now) : toDay;
    if (!okDay(f) || !okDay(t)) throw httpError(400, 'from and to must look like 2026-10-31');
    if (f > t) throw httpError(400, 'The from day must not be after the to day');
    const from = istStart(f);
    const to = new Date(istStart(t).getTime() + DAY);
    if ((to - from) / DAY > 366) throw httpError(400, 'Choose at most one year');
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);

    const sales = async (a, b) => {
        const [o, bk] = await Promise.all([
            Order.aggregate([{ $match: { tenantId, status: 'delivered', bulkId: { $exists: false }, deliveredAt: { $gte: a, $lt: b } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: NET } } }]),
            BulkOrder.aggregate([{ $match: { tenantId, status: { $in: ['delivered', 'completed'] }, 'stageAt.delivered': { $gte: a, $lt: b } } }, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $subtract: [{ $add: [{ $ifNull: ['$quote.pricing.subtotal', 0] }, { $ifNull: ['$quote.pricing.packagingCharge', 0] }] }, { $ifNull: ['$quote.pricing.discount', 0] }] } } } }]).catch(() => []),
        ]);
        return { orders: (o[0]?.orders || 0) + (bk[0]?.orders || 0), revenue: r2((o[0]?.revenue || 0) + (bk[0]?.revenue || 0)) };
    };
    const costs = async (a, b) => {
        const rows = await ShopExpense.find({ tenantId, $or: [{ repeatMonthly: { $ne: true }, date: { $gte: a, $lt: b } }, { repeatMonthly: true, date: { $lt: b }, $or: [{ endsOn: { $exists: false } }, { endsOn: null }, { endsOn: { $gte: a } }] }] }).lean();
        const by = new Map();
        for (const e of rows) {
            const paise = e.repeatMonthly ? repeatShare(e, a, b) : e.amountPaise;
            if (paise <= 0) continue;
            const key = e.category === 'other' && e.otherName ? `other: ${e.otherName}` : e.category;
            by.set(key, (by.get(key) || 0) + paise);
        }
        const [rent, sms] = await Promise.all([
            SubscriptionInvoice.aggregate([{ $match: { tenantId, status: 'paid', paidAt: { $gte: a, $lt: b } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
            SmsTopup.aggregate([{ $match: { tenantId, status: 'paid', paidAt: { $gte: a, $lt: b } } }, { $group: { _id: null, paise: { $sum: { $ifNull: ['$payablePaise', '$amountPaise'] } } } }]),
        ]);
        const items = [...by.entries()].map(([k, p]) => ({ key: k, label: LABEL[k] || (k.startsWith('other: ') ? k.replace('other: ', 'Other: ') : k), amount: r2(p / 100) })).sort((x, y) => y.amount - x.amount);
        const rentPaid = r2(rent[0]?.total || 0);
        const smsPaid = r2((sms[0]?.paise || 0) / 100);
        const expenses = r2(items.reduce((n, i) => n + i.amount, 0));
        return { items, expenses, rentPaid, smsPaid, total: r2(expenses + rentPaid + smsPaid) };
    };
    const [s, c, ps, pc] = await Promise.all([sales(from, to), costs(from, to), sales(prevFrom, from), costs(prevFrom, from)]);
    const profit = r2(s.revenue - c.total);
    const before = r2(ps.revenue - pc.total);
    return {
        from: f, to: t, days: Math.round(span / DAY),
        sales: s, costs: c, profit, marginPct: s.revenue ? Math.round((profit / s.revenue) * 100) : null,
        before: { profit: before, revenue: ps.revenue, costs: pc.total },
    };
}

module.exports = { build, LABEL, CATEGORIES: ShopExpense.CATEGORIES };
