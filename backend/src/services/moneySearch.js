// One search box for all the money: rent bills, SMS top-ups, refunds, customer payments, your expenses, notes about unpaid rent,
// Razorpay events and the things you marked handled. Type several words, each one must fit, in any order:
//   "savera pending"   "SUB/2026-27/0007"   "pay_Nx3"   "5000"   "hosting"   "SAV-T7"   "refund failed"   "ramesh promised"
// A word can be a status, an amount (rupees), a shop name, an invoice or payment id, a reference, or any text. Read-only.
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsTopup = require('../models/SmsTopup');
const OnlineRefund = require('../models/OnlineRefund');
const OnlinePayment = require('../models/OnlinePayment');
const Expense = require('../models/Expense');
const CollectionNote = require('../models/CollectionNote');
const PaymentWebhookEvent = require('../models/PaymentWebhookEvent');
const HandledMark = require('../models/HandledMark');
const Order = require('../models/Order');
const BulkPayment = require('../models/BulkPayment');
const BulkOrder = require('../models/BulkOrder');
const TableBooking = require('../models/TableBooking');
const { httpError } = require('../middlewares/apiErrors');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LIMIT = 15;
const paise = (rupees) => Math.round((rupees || 0) * 100);

const clean = (q) => String(q || '').trim().slice(0, 100).split(/\s+/).filter(Boolean).slice(0, 8);

// AND over the words; for each word an OR of what that word can mean for this kind of record
async function build(words, perWord) {
    const conds = [];
    for (const w of words) {
        const c = await perWord(w);
        if (c) conds.push(c);
    }
    return conds.length ? { $and: conds } : null;
}
const amountOf = (w) => (/^[₹]?\d+(\.\d{1,2})?$/.test(w) ? Number(w.replace('₹', '')) : null);
const SKIP = new Set(['rs', '₹', 'of', 'the', 'in', 'at']);

async function search(q) {
    const words = clean(q);
    if (String(q || '').trim().length < 2 || !words.length) throw httpError(400, 'Type at least 2 characters');
    const word = (w) => new RegExp(esc(w), 'i');
    const shopIds = new Map();
    const shopsFor = async (w) => {
        if (!shopIds.has(w)) shopIds.set(w, (await Tenant.find({ $or: [{ name: word(w) }, { slug: word(w) }] }).select('_id').limit(60).lean()).map((s) => s._id));
        return shopIds.get(w);
    };

    const invoiceF = await build(words, async (w) => {
        const lw = w.toLowerCase();
        if (SKIP.has(lw)) return null;
        if (['pending', 'unpaid'].includes(lw)) return { status: 'pending' };
        if (lw === 'paid') return { status: 'paid' };
        if (lw === 'void' || lw === 'voided') return { status: 'void' };
        if (lw === 'overdue' || lw === 'late') return { status: 'pending', dueDate: { $lt: new Date() } };
        const or = [{ invoiceNo: word(w) }, { period: word(w) }, { 'buyer.legalName': word(w) }, { 'buyer.gstin': word(w) }, { description: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ total: n }, { baseAmount: n });
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        return { $or: or };
    });
    const topupF = await build(words, async (w) => {
        const lw = w.toLowerCase();
        if (SKIP.has(lw)) return null;
        if (['pending', 'paid', 'expired'].includes(lw)) return { status: lw };
        const or = [{ ref: word(w) }, { paymentId: word(w) }, { rzpOrderId: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ amountPaise: paise(n) }, { payablePaise: paise(n) });
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        return { $or: or };
    });
    const refundF = await build(words, async (w) => {
        const lw = w.toLowerCase();
        if (SKIP.has(lw) || lw === 'refund' || lw === 'refunds') return null;
        if (['pending', 'processing', 'processed', 'failed'].includes(lw)) return { status: lw };
        const or = [{ rzpPaymentId: word(w) }, { rzpRefundId: word(w) }, { lastError: word(w) }, { reason: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ amountPaise: paise(n) });
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        if (/^#?\d{1,9}$/.test(w) || /^[a-z]{2,6}-\d+$/i.test(w)) {
            const od = await Order.find(/^[a-z]{2,6}-\d+$/i.test(w) ? { ref: w.toUpperCase() } : { orderNo: Number(w.replace('#', '')) }).select('_id').limit(40).lean();
            if (od.length) or.push({ orderId: { $in: od.map((o) => o._id) } });
        }
        return { $or: or };
    });
    const paymentF = await build(words, async (w) => {
        const lw = w.toLowerCase();
        if (SKIP.has(lw)) return null;
        const or = [{ rzpPaymentId: word(w) }, { rzpOrderId: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ amountPaise: paise(n) });
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        return { $or: or };
    });
    // the online money of BULK orders (the advance and the balance) is in its own table: found by a payment id, an amount, a shop, a status or the bulk order's code
    const bulkPayF = await build(words, async (w) => {
        const lw = w.toLowerCase();
        if (SKIP.has(lw) || lw === 'bulk') return null;
        if (['captured', 'created'].includes(lw)) return { status: lw };
        if (['advance', 'balance'].includes(lw)) return { kind: lw };
        if (['refunded', 'sending', 'failed'].includes(lw)) return { 'refund.status': lw };
        const or = [{ rzpPaymentId: word(w) }, { rzpOrderId: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ amountPaise: paise(n) });
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        if (/^[A-Za-z0-9]{4,8}$/.test(w)) {
            const bs = await BulkOrder.find({ code: w.toUpperCase() }).select('_id').limit(40).lean();
            if (bs.length) or.push({ bulkId: { $in: bs.map((b) => b._id) } });
        }
        return { $or: or };
    });
    // the deposit a guest paid online to book a table is kept on the booking itself: found by a payment id, the booking code, the guest, an amount, a shop or its state
    const depositF = await build(words, async (w) => {
        const lw = w.toLowerCase();
        if (SKIP.has(lw) || lw === 'deposit' || lw === 'booking' || lw === 'table') return null;
        if (['paid', 'refunded', 'kept', 'adjusted'].includes(lw)) return { 'deposit.status': lw };
        const or = [{ 'payment.rzpPaymentId': word(w) }, { 'payment.rzpOrderId': word(w) }, { code: word(w) }, { name: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ 'payment.amountPaise': paise(n) });
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        return { $or: or };
    });
    const expenseF = await build(words, async (w) => {
        if (SKIP.has(w.toLowerCase())) return null;
        const or = [{ vendor: word(w) }, { note: word(w) }, { category: word(w) }];
        const n = amountOf(w);
        if (n !== null) or.push({ amountPaise: paise(n) });
        return { $or: or };
    });
    const noteF = await build(words, async (w) => {
        if (SKIP.has(w.toLowerCase())) return null;
        const or = [{ note: word(w) }, { by: word(w) }];
        const sids = w.length >= 3 ? await shopsFor(w) : [];
        if (sids.length) or.push({ tenantId: { $in: sids } });
        return { $or: or };
    });
    const eventF = await build(words, async (w) => (SKIP.has(w.toLowerCase()) ? null : { $or: [{ event: word(w) }, { eventId: word(w) }, { error: word(w) }] }));
    const markF = await build(words, async (w) => (SKIP.has(w.toLowerCase()) ? null : { $or: [{ note: word(w) }, { title: word(w) }, { by: word(w) }, { kind: word(w.replace(/\s/g, '_')) }] }));
    const shopF = words.length === 1 && words[0].length >= 2 ? { $or: [{ name: word(words[0]) }, { slug: word(words[0]) }, { phone: word(words[0]) }] } : null;

    const [invoices, topups, refunds, payments, bulkPays, deposits, expenses, notes, events, marks, shops] = await Promise.all([
        invoiceF ? SubscriptionInvoice.find(invoiceF).sort({ issueDate: -1 }).limit(LIMIT).select('tenantId invoiceNo total status period dueDate').lean() : [],
        topupF ? SmsTopup.find(topupF).sort({ createdAt: -1 }).limit(LIMIT).select('tenantId ref amountPaise payablePaise status paymentId paidAt createdAt').lean() : [],
        refundF ? OnlineRefund.find(refundF).sort({ createdAt: -1 }).limit(LIMIT).lean() : [],
        paymentF ? OnlinePayment.find(paymentF).sort({ createdAt: -1 }).limit(LIMIT).select('tenantId orderId rzpPaymentId amountPaise status capturedAt createdAt').lean() : [],
        bulkPayF ? BulkPayment.find(bulkPayF).sort({ createdAt: -1 }).limit(LIMIT).select('tenantId bulkId kind rzpPaymentId amountPaise status capturedAt createdAt refund').lean() : [],
        depositF ? TableBooking.find({ 'payment.amountPaise': { $gt: 0 }, $and: [depositF] }).sort({ 'payment.paidAt': -1 }).limit(LIMIT).select('tenantId code name payment deposit').lean() : [],
        expenseF ? Expense.find(expenseF).sort({ date: -1 }).limit(LIMIT).lean() : [],
        noteF ? CollectionNote.find(noteF).sort({ createdAt: -1 }).limit(LIMIT).lean() : [],
        eventF ? PaymentWebhookEvent.find({ account: 'platform', ...eventF }).sort({ createdAt: -1 }).limit(LIMIT).select('event eventId status error createdAt').lean() : [],
        markF ? HandledMark.find({ scope: 'money', ...markF }).sort({ createdAt: -1 }).limit(LIMIT).lean() : [],
        shopF ? Tenant.find(shopF).select('name slug billing.state').limit(8).lean() : [],
    ]);

    const need = [...invoices, ...topups, ...refunds, ...payments, ...bulkPays, ...deposits, ...notes].map((x) => String(x.tenantId));
    const bulkCodes = new Map((bulkPays.length ? await BulkOrder.find({ _id: { $in: bulkPays.map((x) => x.bulkId) } }).select('code').lean() : []).map((b) => [String(b._id), b.code]));
    const orders = new Map((await Order.find({ _id: { $in: [...refunds, ...payments].map((x) => x.orderId) } }).select('orderNo ref').lean()).map((o) => [String(o._id), o]));
    const names = new Map((await Tenant.find({ _id: { $in: need.filter((x) => mongoose.isValidObjectId(x)) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    const nm = (id) => names.get(String(id)) || 'Shop';
    const ordLabel = (id) => { const o = orders.get(String(id)); return o ? (o.ref || `#${o.orderNo}`) : ''; };
    const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

    const groups = [
        { key: 'shops', title: 'Shops', items: shops.map((s) => ({ id: String(s._id), title: s.name, detail: `Bill status: ${s.billing?.state || 'ok'}`, open: { screen: 'ShopBilling', params: { shopId: String(s._id), name: s.name }, tab: 'ShopsTab' } })) },
        { key: 'invoices', title: 'Rent bills', items: invoices.map((i) => ({ id: String(i._id), title: `${i.invoiceNo} · ${nm(i.tenantId)}`, detail: `${i.status}${i.period ? ` · ${i.period}` : ''}${i.status === 'pending' ? ` · due ${date(i.dueDate)}` : ''}`, paise: paise(i.total), open: { screen: 'InvoiceDetail', params: { invoiceId: String(i._id), invoiceNo: i.invoiceNo } } })) },
        { key: 'topups', title: 'SMS top-ups', items: topups.map((x) => ({ id: String(x._id), title: `${x.ref || 'Top-up'} · ${nm(x.tenantId)}`, detail: `${x.status}${x.paymentId ? ` · ${x.paymentId}` : ''} · ${date(x.paidAt || x.createdAt)}`, paise: x.payablePaise || x.amountPaise, open: { screen: 'Ledger' } })) },
        { key: 'refunds', title: 'Refunds', items: refunds.map((r) => ({ id: String(r._id), title: `${nm(r.tenantId)} · order ${ordLabel(r.orderId)}`, detail: `${r.status}${r.lastError ? ` · ${r.lastError}` : ''} · ${date(r.createdAt)}`, paise: r.amountPaise, open: { screen: 'Refunds' } })) },
        { key: 'payments', title: 'Customer payments', items: payments.map((p) => ({ id: String(p._id), title: `${nm(p.tenantId)} · order ${ordLabel(p.orderId)}`, detail: `${p.status}${p.rzpPaymentId ? ` · ${p.rzpPaymentId}` : ''} · ${date(p.capturedAt || p.createdAt)}`, paise: p.amountPaise, open: { screen: 'OrderDetail', params: { orderId: String(p.orderId) } } })) },
        { key: 'bulkPayments', title: 'Bulk order payments', items: bulkPays.map((p) => ({ id: String(p._id), title: `${nm(p.tenantId)} · bulk order ${bulkCodes.get(String(p.bulkId)) || ''}`, detail: `${p.kind} · ${p.status}${p.refund?.status ? ` · refund ${p.refund.status}` : ''}${p.rzpPaymentId ? ` · ${p.rzpPaymentId}` : ''} · ${date(p.capturedAt || p.createdAt)}`, paise: p.amountPaise, open: { screen: 'ShopBulk', params: { shopId: String(p.tenantId), name: nm(p.tenantId) } } })) },
        { key: 'deposits', title: 'Table booking deposits', items: deposits.map((b) => ({ id: String(b._id), title: `${nm(b.tenantId)} · table booking ${b.code} · ${b.name}`, detail: `${b.deposit?.status || 'paid'}${b.payment?.rzpPaymentId ? ` · ${b.payment.rzpPaymentId}` : ''} · ${date(b.payment?.paidAt)}`, paise: b.payment?.amountPaise, open: { screen: 'ShopPayments', params: { shopId: String(b.tenantId), name: nm(b.tenantId) } } })) },
        { key: 'expenses', title: 'Your expenses', items: expenses.map((e) => ({ id: String(e._id), title: `${e.category}${e.vendor ? ` · ${e.vendor}` : ''}`, detail: `${e.note || ''} ${date(e.date)}`.trim(), paise: e.amountPaise, open: { screen: 'Expenses' } })) },
        { key: 'notes', title: 'Notes about unpaid rent', items: notes.map((n) => ({ id: String(n._id), title: `${nm(n.tenantId)} · ${n.status}`, detail: `${n.note}${n.promiseDate ? ` · promised ${date(n.promiseDate)}` : ''}`, open: { screen: 'Receivables' } })) },
        { key: 'events', title: 'Razorpay events', items: events.map((e) => ({ id: String(e._id), title: e.event || 'event', detail: `${e.status}${e.error ? ` · ${String(e.error).slice(0, 120)}` : ''} · ${date(e.createdAt)}`, open: { screen: 'MyRazorpay' } })) },
        { key: 'handled', title: 'Marked handled', items: marks.map((m) => ({ id: String(m._id), title: m.title || m.kind, detail: `${m.undoneAt ? 'taken back' : 'handled'} by ${m.by || 'you'}${m.note ? ` · ${m.note}` : ''} · ${date(m.createdAt)}`, open: { screen: 'MoneyAttention', params: { key: ({ refund_failed: 'refunds_failed' }[m.kind]) || m.kind } } })) },
    ].filter((g) => g.items.length);

    return { q: words.join(' '), total: groups.reduce((n, g) => n + g.items.length, 0), groups };
}

module.exports = { search };
