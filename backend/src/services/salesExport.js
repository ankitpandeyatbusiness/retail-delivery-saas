// The owner's sales as an Excel file: one sheet of orders, one of days, one of items. Orders are the ones PLACED in the
// range (online orders that were never paid are left out, like everywhere else); the money columns are rupees.
const ExcelJS = require('exceljs');
const Order = require('../models/Order');
const BulkOrder = require('../models/BulkOrder');
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

const BULK_STATUS = { requested: 'Waiting for quote', quoted: 'Quote sent', confirmed: 'Advance paid', preparing: 'Being made', ready: 'Ready', out_for_delivery: 'On the way', delivered: 'Delivered', completed: 'Completed', declined: 'Declined', cancelled: 'Cancelled', expired: 'Quote expired' };

async function build({ tenantId, from, to }) {
    const orders = await Order.find({ tenantId, ...HIDE_UNPAID, ...require('./onlineOrder').HIDE_BULK_TICKET, createdAt: { $gte: from, $lte: to } })
        .sort({ createdAt: -1 }).limit(MAX_ORDERS + 1)
        .select('orderNo createdAt deliveredAt status orderType customer items pricing payment cancelledBy').lean();
    const truncated = orders.length > MAX_ORDERS;
    if (truncated) orders.pop();
    // the BULK orders of the same period (their work tickets are left out of the Orders sheet above: a ticket's own total is only the balance)
    const bulks = await BulkOrder.find({ tenantId, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).limit(MAX_ORDERS)
        .select('code createdAt when status fulfilment contact lines quote pricing payment cancelledBy stageAt').lean();

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

    // the bulk orders: one row each, with what it was worth and how it was paid
    const bulkSheet = wb.addWorksheet('Bulk orders');
    bulkSheet.columns = [
        { header: 'Bulk code', key: 'code', width: 11 }, { header: 'Placed (IST)', key: 'at', width: 18 }, { header: 'Wanted for (IST)', key: 'when', width: 18 }, { header: 'Status', key: 'status', width: 18 },
        { header: 'Type', key: 'type', width: 10 }, { header: 'Customer', key: 'cust', width: 20 }, { header: 'Phone', key: 'phone', width: 14 }, { header: 'Items', key: 'items', width: 40 },
        { header: 'Sales (after discount)', key: 'sales', width: 20 }, { header: 'Total with tax and fees', key: 'total', width: 20 }, { header: 'Advance paid (online)', key: 'adv', width: 20 },
        { header: 'Balance', key: 'bal', width: 11 }, { header: 'Balance paid', key: 'balpaid', width: 13 }, { header: 'Balance paid by', key: 'via', width: 14 },
        { header: 'Refunded', key: 'ref', width: 11 }, { header: 'Cancelled by', key: 'by', width: 13 },
    ];
    styleHead(bulkSheet);
    const bulkDays = new Map();
    for (const b of bulks) {
        const q = b.quote?.pricing || b.pricing || {};
        const pay = b.payment || {};
        const net = NET(b.quote?.pricing || {});
        bulkSheet.addRow({
            code: b.code, at: ist(b.createdAt), when: ist(b.when), status: BULK_STATUS[b.status] || b.status, type: b.fulfilment,
            cust: safe(b.contact?.name || ''), phone: safe(b.contact?.phone || ''), items: safe((b.lines || []).map((i) => `${i.name} x${i.quantity}`).join(', ')),
            sales: ['delivered', 'completed'].includes(b.status) ? net : '', total: r2(q.total || 0),
            adv: pay.advancePaise ? r2(pay.advancePaise / 100) : '', bal: b.quote?.balancePaise ? r2(b.quote.balancePaise / 100) : '',
            balpaid: pay.balancePaid ? 'Yes' : (pay.advancePaise ? 'No' : ''), via: pay.balanceVia || '', ref: pay.refundPaise ? r2(pay.refundPaise / 100) : '', by: b.cancelledBy || '',
        });
        if (['delivered', 'completed'].includes(b.status)) {
            const k = istDay(b.stageAt?.delivered || b.createdAt);
            const d = bulkDays.get(k) || { orders: 0, revenue: 0 };
            d.orders += 1; d.revenue += net;
            bulkDays.set(k, d);
        }
    }

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
        { header: 'Of which bulk orders', key: 'bn', width: 18 }, { header: 'Bulk sales', key: 'brev', width: 12 },
    ];
    styleHead(byDay);
    // the delivered bulk orders are sales too: each day shows them inside its totals, and how many and how much of it was bulk
    const dayKeys = [...new Set([...days.keys(), ...bulkDays.keys()])].sort();
    for (const k of dayKeys) {
        const d = days.get(k) || { orders: 0, revenue: 0, tax: 0, fees: 0, tips: 0, discount: 0 };
        const b = bulkDays.get(k) || { orders: 0, revenue: 0 };
        byDay.addRow({ day: k, n: d.orders + b.orders, rev: r2(d.revenue + b.revenue), disc: r2(d.discount), fee: r2(d.fees), tax: r2(d.tax), tip: r2(d.tips), bn: b.orders, brev: r2(b.revenue) });
    }
    const tot = dayKeys.reduce((a, k) => { const d = days.get(k) || { orders: 0, revenue: 0 }; const b = bulkDays.get(k) || { orders: 0, revenue: 0 }; return { n: a.n + d.orders + b.orders, rev: a.rev + d.revenue + b.revenue, bn: a.bn + b.orders, brev: a.brev + b.revenue }; }, { n: 0, rev: 0, bn: 0, brev: 0 });
    byDay.addRow({ day: 'Total', n: tot.n, rev: r2(tot.rev), bn: tot.bn, brev: r2(tot.brev) }).font = { bold: true };

    const top = wb.addWorksheet('Items sold');
    top.columns = [{ header: 'Item', key: 'name', width: 34 }, { header: 'Quantity', key: 'qty', width: 10 }, { header: 'Sales', key: 'rev', width: 12 }];
    styleHead(top);
    for (const it of [...items.values()].sort((a, b) => b.qty - a.qty)) top.addRow({ name: safe(it.name), qty: it.qty, rev: r2(it.revenue) });

    if (truncated) {
        const note = wb.addWorksheet('Note');
        note.addRow([`Only the newest ${MAX_ORDERS} orders are listed. Choose a shorter period to get the rest.`]);
    }
    return { workbook: wb, orders: orders.length, bulkOrders: bulks.length, truncated };
}

module.exports = { build, MAX_ORDERS };
