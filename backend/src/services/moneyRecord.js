// The monthly record of what shops paid (rent, setup and other bills, SMS top-ups), grouped under their brand, and the developer's yes/no per shop:
// "did you get your part?" (50% of a shop Vivyaan brought, 70% of one the developer brought, on the amount before GST).
// A plain record for the two of them: no due dates, no amounts owed, no alerts. The real money moves outside the app.
const mongoose = require('mongoose');
const platformSales = require('./platformSales');
const SmsTopup = require('../models/SmsTopup');
const Tenant = require('../models/Tenant');
const Brand = require('../models/Brand');
const ShopMoneyCheck = require('../models/ShopMoneyCheck');
const { httpError } = require('../middlewares/apiErrors');

const PCT = { owner: 70, partner: 50 };    // owner = the developer brought the shop; partner = Vivyaan did (also when nobody is marked)
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pctOf = (broughtBy) => (broughtBy === 'owner' ? PCT.owner : PCT.partner);

function monthRange(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw httpError(400, 'month must look like 2026-05');
    const [y, m] = month.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    return { $gte: new Date(`${month}-01T00:00:00+05:30`), $lt: new Date(`${next}-01T00:00:00+05:30`) };
}

const nowMonth = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);

// what each shop paid in the month (by the day the money was received): Map tenantId -> [{ kind, label, amount }]
async function paidLines(month) {
    const range = monthRange(month);
    const sales = await platformSales.paid({ from: range.$gte, to: range.$lt });   // plans, extra shops, wallet and SMS top-ups
    const byShop = new Map();
    const add = (tid, line) => { const k = String(tid); if (!byShop.has(k)) byShop.set(k, []); byShop.get(k).push(line); };
    for (const x of sales) {
        if (x.kind === 'wallet' || !(x.baseAmount > 0)) continue;   // a wallet top-up is prepaid money, not a sale
        add(x.tenantId, { kind: x.kind === 'sms' ? 'topup' : 'rent', label: x.description, invoiceNo: x.invoiceNo, amount: round2(x.baseAmount) });
    }
    return byShop;
}

const stateOf = (check, base, pct) => {
    if (!check) return 'open';
    if (Math.abs(check.amount - base) > 0.005 || check.pct !== pct) return 'again';   // something changed since it was answered
    return check.got ? 'yes' : 'no';
};

async function monthView(month = nowMonth()) {
    const byShop = await paidLines(month);
    const ids = [...byShop.keys()].map((k) => new mongoose.Types.ObjectId(k));
    const [tenants, checks] = await Promise.all([
        Tenant.find({ _id: { $in: ids } }).select('name slug brandId branchCity broughtBy').lean(),
        ShopMoneyCheck.find({ month, tenantId: { $in: ids } }).lean(),
    ]);
    const brands = await Brand.find({ _id: { $in: tenants.map((t) => t.brandId).filter(Boolean) } }).select('name').lean();
    const brandName = new Map(brands.map((b) => [String(b._id), b.name]));
    const checkOf = new Map(checks.map((c) => [String(c.tenantId), c]));

    const shops = tenants.map((t) => {
        const lines = byShop.get(String(t._id)) || [];
        const base = round2(lines.reduce((a, l) => a + l.amount, 0));
        const pct = pctOf(t.broughtBy);
        const c = checkOf.get(String(t._id));
        return {
            tenantId: String(t._id), name: t.name, slug: t.slug, branchCity: t.branchCity || '', brandId: t.brandId ? String(t.brandId) : null,
            broughtBy: t.broughtBy || null, pct, base, yourPart: round2((base * pct) / 100), lines,
            check: c ? { got: c.got, reason: c.reason || '', at: c.at, by: c.by?.name || '', amount: c.amount, pct: c.pct } : null, state: stateOf(c, base, pct),
        };
    });

    // a brand is one group with its branches; a shop with no brand is a group of one
    const groups = new Map();
    for (const s of shops) {
        const key = s.brandId || `shop:${s.tenantId}`;
        if (!groups.has(key)) groups.set(key, { brandId: s.brandId, name: s.brandId ? (brandName.get(s.brandId) || s.name) : s.name, base: 0, yourPart: 0, shops: [] });
        const g = groups.get(key);
        g.shops.push(s); g.base = round2(g.base + s.base); g.yourPart = round2(g.yourPart + s.yourPart);
    }
    const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const g of list) g.shops.sort((a, b) => a.name.localeCompare(b.name));
    const totals = { base: round2(shops.reduce((a, s) => a + s.base, 0)), yourPart: round2(shops.reduce((a, s) => a + s.yourPart, 0)), shops: shops.length };
    for (const st of ['yes', 'no', 'open', 'again']) totals[st] = shops.filter((s) => s.state === st).length;
    return { month, groups: list, totals };
}

// the developer answers for one shop and month
async function setCheck({ month, tenantId, got, reason }, admin) {
    monthRange(month);
    if (!mongoose.isValidObjectId(tenantId)) throw httpError(400, 'Choose a shop');
    if (typeof got !== 'boolean') throw httpError(400, 'Answer yes or no');
    const text = String(reason || '').trim();
    if (!got && text.length < 3) throw httpError(400, 'Write the reason');
    const shop = (await monthView(month)).groups.flatMap((g) => g.shops).find((s) => s.tenantId === String(tenantId));
    if (!shop) throw httpError(409, 'This shop paid nothing in this month');
    await ShopMoneyCheck.findOneAndUpdate(
        { month, tenantId },
        { $set: { got, reason: got ? '' : text.slice(0, 300), amount: shop.base, pct: shop.pct, yourPart: shop.yourPart, by: { id: String(admin._id), name: admin.name || admin.email || 'Admin' }, at: new Date() } },
        { upsert: true },
    );
    return (await monthView(month)).groups.flatMap((g) => g.shops).find((s) => s.tenantId === String(tenantId));
}

// who brought the shop: decides 50% or 70%. Only the supreme admin sets it.
async function setBroughtBy(tenantId, broughtBy) {
    if (!['owner', 'partner'].includes(broughtBy)) throw httpError(400, 'broughtBy must be "owner" or "partner"');
    if (!mongoose.isValidObjectId(tenantId)) throw httpError(404, 'Shop not found');
    const t = await Tenant.findByIdAndUpdate(tenantId, { $set: { broughtBy, broughtBySetAt: new Date() } }, { returnDocument: 'after' }).select('name broughtBy').lean();
    if (!t) throw httpError(404, 'Shop not found');
    return { shop: t.name, broughtBy, pct: pctOf(broughtBy) };
}

module.exports = { PCT, pctOf, monthView, setCheck, setBroughtBy };
