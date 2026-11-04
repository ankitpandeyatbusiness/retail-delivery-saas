// "Remind" from the Who-owes-you screen: a push (and the in-app alert) to the owner of ONE shop, or to every branch of a brand that owes rent.
// The text carries the amount and the month. Brand owners get it labelled with the branch, because a bill reminder always reaches them (services/brandNotify.js).
// A shop is reminded at most once an hour, so a double tap or two admins never spam an owner.
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const Tenant = require('../models/Tenant');
const Brand = require('../models/Brand');
const Notification = require('../models/Notification');
const center = require('../notifications/center');
const { httpError } = require('../middlewares/apiErrors');

const HOUR = 3600000;
const rs = (n) => `Rs ${(Math.round(Number(n) * 100) / 100).toLocaleString('en-IN')}`;
const monthName = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });

// what the shop owes right now
async function dueOf(tenantId) {
    const rows = await SubscriptionInvoice.find({ tenantId, status: 'pending' }).select('total issueDate dueDate').sort({ issueDate: -1 }).lean();
    if (!rows.length) return null;
    const total = Math.round(rows.reduce((a, r) => a + Number(r.total || 0), 0) * 100) / 100;
    const latest = rows[0];
    return { total, count: rows.length, month: monthName(latest.issueDate || latest.dueDate), overdue: rows.some((r) => r.dueDate && new Date(r.dueDate) < new Date()) };
}

// one shop. Returns { sent, ... } or throws a plain-words error.
async function remindShop(tenantId, now = new Date()) {
    const shop = await Tenant.findById(tenantId).select('name').lean();
    if (!shop) throw httpError(404, 'Shop not found');
    const due = await dueOf(tenantId);
    if (!due) throw httpError(400, `${shop.name} has no unpaid bill.`);
    const last = await Notification.findOne({ tenantId, role: 'owner', type: 'rent_nudge', createdAt: { $gte: new Date(now.getTime() - HOUR) } }).select('createdAt').lean();
    if (last) {
        const mins = Math.max(1, Math.round((now.getTime() - new Date(last.createdAt).getTime()) / 60000));
        throw httpError(429, `${shop.name} was reminded ${mins} minute${mins === 1 ? '' : 's'} ago. Try again after an hour.`);
    }
    const body = due.count > 1
        ? `Your unpaid rent is ${rs(due.total)} (${due.count} bills, the latest for ${due.month}). Please pay it from the Billing section.`
        : `Your rent of ${rs(due.total)} for ${due.month} is due. Please pay it from the Billing section.`;
    await center.notify('rent_nudge', { tenantId, title: 'Please pay your rent', body, data: { prompt: 'bill', dues: true, manual: true } });
    return { shopName: shop.name, amount: due.total, month: due.month, bills: due.count };
}

// every branch of a brand that owes something: one reminder each (a branch reminded in the last hour is skipped, not an error)
async function remindBrand(brandId, now = new Date()) {
    const brand = await Brand.findById(brandId).select('name').lean();
    if (!brand) throw httpError(404, 'Brand not found');
    const branches = await Tenant.find({ brandId }).select('name').lean();
    const sent = []; const skipped = [];
    for (const b of branches) {
        try { sent.push(await remindShop(b._id, now)); } catch (e) { if (e.status === 400 || e.status === 429) skipped.push({ shopName: b.name, reason: e.message }); else throw e; }
    }
    return { brandName: brand.name, sent, skipped };
}

module.exports = { remindShop, remindBrand, dueOf };
