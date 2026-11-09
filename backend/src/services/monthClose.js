// Closing a month: one summary (this month against last), what to expect in the next 30 days, and one Excel for the CA.
// Everything comes from the same records as Profit and loss, the GST register and the numbers agree everywhere.
const platformSales = require('./platformSales');
const Expense = require('../models/Expense');
const Tenant = require('../models/Tenant');
const finance = require('./financeService');
const gstRegister = require('./gstRegister');
const { buildWorkbook } = require('./xlsxExport');
const { httpError } = require('../middlewares/apiErrors');

const DAY = 86400000;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const prevKey = (k) => { const [y, m] = k.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const nowKey = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const okMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));

async function summary(month = nowKey()) {
    if (!okMonth(month)) throw httpError(400, 'month must look like 2026-11');
    const [fin, reg] = await Promise.all([finance.summary({ months: 12 }), gstRegister.build({ month })]);
    const row = (k) => fin.rows.find((r) => r.month === k) || { month: k, billedPaise: 0, collectedPaise: 0, rentIncomePaise: 0, smsMarginPaise: 0, costsPaise: 0, netPaise: 0, incomePaise: 0, expensesPaise: 0, gstPaise: 0 };
    const cur = row(month);
    const before = row(prevKey(month));
    return {
        month, previousMonth: prevKey(month), current: cur, previous: before,
        change: { billed: pct(cur.billedPaise, before.billedPaise), collected: pct(cur.collectedPaise, before.collectedPaise), income: pct(cur.incomePaise, before.incomePaise), costs: pct(cur.costsPaise, before.costsPaise), net: before.netPaise > 0 ? pct(cur.netPaise, before.netPaise) : null },
        gst: { toPay: reg.summary.gst, onUnpaidBills: reg.summary.gstOnUnpaidBills, documents: reg.summary.documents, taxable: reg.summary.taxable },
        owed: { pendingPaise: 0, overduePaise: 0, overdueShops: 0 },
        verdict: cur.netPaise > 0 ? 'profit' : cur.netPaise < 0 ? 'loss' : 'break_even',
    };
}

// What is likely to come in and go out over the next 30 days. Estimates say so: the next bills are guessed from the last month's, the costs from the last three.
async function next30({ now = Date.now() } = {}) {
    const n = new Date(now);
    const fin = await finance.summary({ months: 3 });
    const k = nowKey();
    const done = fin.rows.filter((r) => r.month < k);   // finished months only
    const lastBilled = done.length ? done[done.length - 1].billedPaise : 0;
    const avgCosts = done.length ? Math.round(done.reduce((a, r) => a + r.costsPaise, 0) / done.length) : 0;
    const net = lastBilled - avgCosts;
    return {
        dueSoon: { paise: 0, bills: 0 },   // everything is prepaid: nothing falls due
        overdue: { paise: 0, bills: 0 },
        nextBillsEstimatePaise: lastBilled,
        costsEstimatePaise: avgCosts,
        netEstimatePaise: net,
        note: 'Everything is prepaid. The next income is guessed from last month, the costs from the last three months.',
    };
}

const rs = (paise) => round2((paise || 0) / 100);

async function workbook(month) {
    if (!okMonth(month)) throw httpError(400, 'month must look like 2026-11');
    const [s, reg] = await Promise.all([summary(month), gstRegister.build({ month })]);
    const range = gstRegister.range(month);
    const [sales, expenses] = await Promise.all([platformSales.paid({ from: range.from, to: range.to }), Expense.find({}).lean()]);
    const bills = sales.filter((x) => x.kind !== 'sms');
    const topups = sales.filter((x) => x.kind === 'sms');
    const shops = new Map((await Tenant.find({ _id: { $in: [...new Set([...bills, ...topups].map((x) => String(x.tenantId)))] } }).select('name refCode').lean()).map((t) => [String(t._id), t]));
    const shopName = (id) => shops.get(String(id))?.name || '';
    const shopCode = (id) => shops.get(String(id))?.refCode || '';
    const spent = expenses.flatMap((e) => (finance.expenseMonths(e, month, month).length ? [e] : []));
    const c = s.current;

    return buildWorkbook([
        {
            title: 'Summary', subtitle: month,
            columns: [{ header: 'Measure', key: 'what' }, { header: 'This month', key: 'now', kind: 'money' }, { header: 'Last month', key: 'before', kind: 'money' }],
            rows: [
                { what: 'Plans, extra shops and wallets billed', now: rs(c.billedPaise), before: rs(s.previous.billedPaise) },
                { what: 'Plans, extra shops and wallets collected', now: rs(c.collectedPaise), before: rs(s.previous.collectedPaise) },
                { what: 'Plan and fee income (before GST)', now: rs(c.rentIncomePaise), before: rs(s.previous.rentIncomePaise) },
                { what: 'SMS margin', now: rs(c.smsMarginPaise), before: rs(s.previous.smsMarginPaise) },
                { what: 'Total income', now: rs(c.incomePaise), before: rs(s.previous.incomePaise) },
                { what: 'Costs', now: rs(c.costsPaise), before: rs(s.previous.costsPaise) },
                { what: 'Net', now: rs(c.netPaise), before: rs(s.previous.netPaise) },
                { what: 'GST on payments this month', now: s.gst.toPay, before: 0 },
            ],
        },
        {
            title: 'Payments received',
            columns: [
                { header: 'Date', key: 'date', kind: 'date' }, { header: 'Invoice no', key: 'no' }, { header: 'Shop', key: 'shop' }, { header: 'Shop code', key: 'code', kind: 'center' },
                { header: 'Kind', key: 'kind' }, { header: 'Period', key: 'period', kind: 'center' }, { header: 'Amount before GST', key: 'base', kind: 'money' }, { header: 'GST', key: 'gst', kind: 'money' },
                { header: 'Total', key: 'total', kind: 'money' }, { header: 'Status', key: 'status', kind: 'status' }, { header: 'Paid on', key: 'paidAt', kind: 'date' }, { header: 'Paid by', key: 'mode' }, { header: 'Payment ref', key: 'ref' },
            ],
            rows: bills.map((i) => ({ date: i.issueDate, no: i.invoiceNo, shop: shopName(i.tenantId), code: shopCode(i.tenantId), kind: i.description, period: '', base: i.baseAmount, gst: i.gstAmount, total: i.total, status: 'paid', paidAt: i.paidAt, mode: i.paymentMode || '', ref: i.paymentRef || '' })),
            total: true,
        },
        {
            title: 'SMS top-ups',
            columns: [
                { header: 'Paid on', key: 'paidAt', kind: 'date' }, { header: 'Reference', key: 'ref', kind: 'center' }, { header: 'Invoice no', key: 'no' }, { header: 'Shop', key: 'shop' },
                { header: 'Wallet credit', key: 'credit', kind: 'money' }, { header: 'GST', key: 'gst', kind: 'money' }, { header: 'Paid', key: 'paid', kind: 'money' },
            ],
            rows: topups.map((t) => ({ paidAt: t.paidAt, ref: t.id, no: t.invoiceNo || '', shop: shopName(t.tenantId), credit: t.baseAmount, gst: t.gstAmount, paid: t.total })),
            total: true,
        },
        {
            title: 'GST register', subtitle: `${reg.summary.documents} documents`,
            columns: [
                { header: 'Date', key: 'date', kind: 'date' }, { header: 'Type', key: 'type' }, { header: 'Document no', key: 'docNo' }, { header: 'Buyer', key: 'buyer' }, { header: 'Buyer GSTIN', key: 'buyerGstin' },
                { header: 'B2B / B2C', key: 'supply', kind: 'center' }, { header: 'Taxable value', key: 'taxable', kind: 'money' }, { header: 'CGST', key: 'cgst', kind: 'money' }, { header: 'SGST', key: 'sgst', kind: 'money' },
                { header: 'IGST', key: 'igst', kind: 'money' }, { header: 'Total', key: 'total', kind: 'money' }, { header: 'Status', key: 'status', kind: 'status' },
            ],
            rows: reg.rows, total: true,
        },
        {
            title: 'Expenses',
            columns: [{ header: 'Date', key: 'date', kind: 'date' }, { header: 'Category', key: 'category' }, { header: 'Vendor', key: 'vendor' }, { header: 'Note', key: 'note', kind: 'wide' }, { header: 'Repeats monthly', key: 'repeat', kind: 'center' }, { header: 'Amount', key: 'amount', kind: 'money' }],
            rows: spent.map((e) => ({ date: e.date, category: e.category === 'other' && e.otherName ? `other: ${e.otherName}` : e.category, vendor: e.vendor || '', note: e.note || '', repeat: e.repeatMonthly ? 'Yes' : '', amount: rs(e.amountPaise) })),
            total: true,
        },
    ]);
}

module.exports = { summary, next30, workbook, okMonth };
