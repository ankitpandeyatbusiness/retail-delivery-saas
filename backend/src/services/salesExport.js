// The owner's sales as an Excel file: one sheet of orders, one of days, one of items. Orders are the ones PLACED in the
// range (online orders that were never paid are left out, like everywhere else); the money columns are rupees.
const ExcelJS = require('exceljs');
const Order = require('../models/Order');
const { HIDE_UNPAID } = require('./onlineOrder');

const MAX_ORDERS = 5000;
const IST_MS = 330 * 60000;
const ist = (d) => (d ? new Date(new Date(d).getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 16) : '');
const istDay = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// a cell must never start like a formula
const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const NET = (p = {}) => r2((p.subtotal || 0) + (p.packagingCharge || 0) - (p.discount || 0));

function styleHead(ws) {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function build({ tenantId, from, to }) {
    const orders = await Order.find({ tenantId, ...HIDE_UNPAID, createdAt: { $gte: from, $lte: to } })
        .sort({ createdAt: -1 }).limit(MAX_ORDERS + 1)
        .select('orderNo createdAt deliveredAt status orderType customer items pricing payment cancelledBy').lean();
    const truncated = orders.length > MAX_ORDERS;
    if (truncated) orders.pop();

    const wb = new ExcelJS.Workbook();
    wb.created = new Date();

    const sheet = wb.addWorksheet('Orders');
    sheet.columns = [
        { header: 'Order no', key: 'no', width: 10 }, { header: 'Placed (IST)', key: 'at', width: 18 }, { header: 'Delivered (IST)', key: 'del', width: 18 },
        { header: 'Status', key: 'status', width: 14 }, { header: 'Type', key: 'type', width: 10 }, { header: 'Customer', key: 'cust', width: 20 },
        { header: 'Phone', key: 'phone', width: 14 }, { header: 'Items', key: 'items', width: 40 }, { header: 'Payment', key: 'pay', width: 10 },
        { header: 'Paid?', key: 'paid', width: 10 }, { header: 'Subtotal', key: 'sub', width: 11 }, { header: 'Discount', key: 'disc', width: 10 },
        { header: 'Delivery fee', key: 'fee', width: 11 }, { header: 'Packaging', key: 'pack', width: 10 }, { header: 'Tax', key: 'tax', width: 9 },
        { header: 'Tip', key: 'tip', width: 8 }, { header: 'Total', key: 'total', width: 11 },
    ];
    styleHead(sheet);

    const days = new Map();
    const items = new Map();
    for (const o of orders) {
        const p = o.pricing || {};
        sheet.addRow({
            no: o.orderNo, at: ist(o.createdAt), del: ist(o.deliveredAt), status: o.status, type: o.orderType,
            cust: safe(o.customer?.deleted ? 'Deleted customer' : o.customer?.name || ''), phone: o.customer?.deleted ? '' : safe(o.customer?.phone || ''),
            items: safe((o.items || []).map((i) => `${i.name} x${i.quantity}`).join(', ')),
            pay: o.payment?.method, paid: o.payment?.status,
            sub: r2(p.subtotal || 0), disc: r2(p.discount || 0), fee: r2(p.deliveryFee || 0), pack: r2(p.packagingCharge || 0),
            tax: r2(p.tax || 0), tip: r2(p.tip || 0), total: r2(p.total || 0),
        });
        if (o.status !== 'delivered') continue;
        const k = istDay(o.deliveredAt || o.createdAt);
        const d = days.get(k) || { orders: 0, revenue: 0, tax: 0, fees: 0, tips: 0, discount: 0 };
        d.orders += 1; d.revenue += NET(p); d.tax += p.tax || 0; d.fees += p.deliveryFee || 0; d.tips += p.tip || 0; d.discount += p.discount || 0;
        days.set(k, d);
        for (const i of o.items || []) {
            const key = String(i.productId || i.name);
            const it = items.get(key) || { name: i.name, qty: 0, revenue: 0 };
            it.qty += i.quantity || 0; it.revenue += i.lineTotal || 0;
            items.set(key, it);
        }
    }

    const byDay = wb.addWorksheet('Sales by day');
    byDay.columns = [
        { header: 'Day', key: 'day', width: 12 }, { header: 'Delivered orders', key: 'n', width: 16 }, { header: 'Sales (after discount)', key: 'rev', width: 20 },
        { header: 'Discounts', key: 'disc', width: 11 }, { header: 'Delivery fees', key: 'fee', width: 13 }, { header: 'Tax', key: 'tax', width: 9 }, { header: 'Tips', key: 'tip', width: 8 },
    ];
    styleHead(byDay);
    for (const [k, d] of [...days.entries()].sort()) byDay.addRow({ day: k, n: d.orders, rev: r2(d.revenue), disc: r2(d.discount), fee: r2(d.fees), tax: r2(d.tax), tip: r2(d.tips) });
    const tot = [...days.values()].reduce((a, d) => ({ n: a.n + d.orders, rev: a.rev + d.revenue }), { n: 0, rev: 0 });
    byDay.addRow({ day: 'Total', n: tot.n, rev: r2(tot.rev) }).font = { bold: true };

    const top = wb.addWorksheet('Items sold');
    top.columns = [{ header: 'Item', key: 'name', width: 34 }, { header: 'Quantity', key: 'qty', width: 10 }, { header: 'Sales', key: 'rev', width: 12 }];
    styleHead(top);
    for (const it of [...items.values()].sort((a, b) => b.qty - a.qty)) top.addRow({ name: safe(it.name), qty: it.qty, rev: r2(it.revenue) });

    if (truncated) {
        const note = wb.addWorksheet('Note');
        note.addRow([`Only the newest ${MAX_ORDERS} orders are listed. Choose a shorter period to get the rest.`]);
    }
    return { workbook: wb, orders: orders.length, truncated };
}

module.exports = { build, MAX_ORDERS };
