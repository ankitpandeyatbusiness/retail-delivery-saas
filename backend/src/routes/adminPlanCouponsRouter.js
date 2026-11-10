// Superadmin: platform coupons for plan payments. Mounted inside adminRouter. Reads: any superadmin. Every change: supreme only (moneyGuard MONEY list).
//
//   GET  /api/admin/plan-coupons                list with uses and how many shops can use each now
//   POST /api/admin/plan-coupons                { code, pct, plans?, months?, startsOn, endsOn (YYYY-MM-DD), shops?, maxUses?, note? }
//   PUT  /api/admin/plan-coupons/:id            { active?, endsOn?, maxUses?, note? }  switch off / extend
//   GET  /api/admin/plan-coupons/:id/texts      ready-made push texts for this coupon
//   POST /api/admin/plan-coupons/:id/notify     { title, body }  push to every shop that can use it now
const express = require('express');
const mongoose = require('mongoose');
const PlatformCoupon = require('../models/PlatformCoupon');
const coupons = require('../services/platformCoupons');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const actorOf = (req) => req.admin?.phone || req.admin?.email || 'supreme admin';

const view = async (c, now) => ({
    id: String(c._id), code: c.code, pct: c.pct, plans: c.plans, months: c.months, startsAt: c.startsAt, endsAt: c.endsAt,
    shops: c.shops.map(String), maxUses: c.maxUses, usedCount: c.usedCount, active: c.active, live: coupons.live(c, now), note: c.note || '', notifiedAt: c.notifiedAt || null,
    eligibleShops: c.active ? (await coupons.eligibleShops(c, now)).length : 0,
});

router.get('/plan-coupons', wrap(async (req, res) => {
    const now = new Date();
    const list = await PlatformCoupon.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ coupons: await Promise.all(list.map((c) => view(c, now))) });
}));

router.post('/plan-coupons', requireSupreme, wrap(async (req, res) => {
    const b = req.body || {};
    const code = coupons.cleanCode(b.code);
    if (code.length < 3 || code.length > 20) throw httpError(400, 'The code needs 3 to 20 letters or numbers');
    const pct = Number(b.pct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 90) throw httpError(400, 'The discount must be a whole number from 1 to 90');
    if (!YMD.test(b.startsOn || '') || !YMD.test(b.endsOn || '')) throw httpError(400, 'Choose the start and end dates');
    const startsAt = coupons.startOfDay(b.startsOn); const endsAt = coupons.endOfDay(b.endsOn);
    if (endsAt <= startsAt) throw httpError(400, 'The end date must be after the start date');
    const plans = (Array.isArray(b.plans) && b.plans.length ? b.plans : ['growth', 'pro']);
    if (plans.some((p) => !['growth', 'pro'].includes(p))) throw httpError(400, 'A coupon is for Growth, Pro or both');
    const months = Array.isArray(b.months) ? b.months.map(Number) : [];
    if (months.some((m) => !Number.isInteger(m) || m < 1 || m > 6)) throw httpError(400, 'Choose 1 to 6 months');
    const shops = Array.isArray(b.shops) ? b.shops.filter((id) => mongoose.isValidObjectId(id)) : [];
    const maxUses = b.maxUses === undefined || b.maxUses === null || b.maxUses === '' ? null : Number(b.maxUses);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) throw httpError(400, 'The use limit must be a whole number above 0');
    if (await PlatformCoupon.findOne({ code }).select('_id').lean()) throw httpError(409, 'That code already exists');
    const c = await PlatformCoupon.create({ code, pct, plans, months, startsAt, endsAt, shops, maxUses, note: String(b.note || '').slice(0, 200), createdBy: actorOf(req) });
    res.status(201).json(await view(c.toObject(), new Date()));
}));

router.put('/plan-coupons/:id', requireSupreme, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Coupon not found');
    const b = req.body || {};
    const set = {};
    if (typeof b.active === 'boolean') set.active = b.active;
    if (b.endsOn !== undefined) { if (!YMD.test(b.endsOn)) throw httpError(400, 'Choose the end date'); set.endsAt = coupons.endOfDay(b.endsOn); }
    if (b.maxUses !== undefined) { const m = b.maxUses === null || b.maxUses === '' ? null : Number(b.maxUses); if (m !== null && (!Number.isInteger(m) || m < 1)) throw httpError(400, 'The use limit must be a whole number above 0'); set.maxUses = m; }
    if (b.note !== undefined) set.note = String(b.note).slice(0, 200);
    const c = await PlatformCoupon.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).lean();
    if (!c) throw httpError(404, 'Coupon not found');
    res.json(await view(c, new Date()));
}));

// delete a coupon nobody has used (a used one is only switched off, so the record of who got what stays)
router.delete('/plan-coupons/:id', requireSupreme, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Coupon not found');
    const c = await PlatformCoupon.findById(req.params.id).lean();
    if (!c) throw httpError(404, 'Coupon not found');
    if (c.usedCount > 0) throw httpError(409, 'This coupon was used, so it cannot be deleted. Switch it off instead.');
    await PlatformCoupon.deleteOne({ _id: c._id });
    res.json({ ok: true });
}));

router.get('/plan-coupons/:id/texts', wrap(async (req, res) => {
    const c = mongoose.isValidObjectId(req.params.id) ? await PlatformCoupon.findById(req.params.id).lean() : null;
    if (!c) throw httpError(404, 'Coupon not found');
    res.json({ texts: coupons.textsFor(c) });
}));

router.post('/plan-coupons/:id/notify', requireSupreme, wrap(async (req, res) => {
    const c = mongoose.isValidObjectId(req.params.id) ? await PlatformCoupon.findById(req.params.id).lean() : null;
    if (!c) throw httpError(404, 'Coupon not found');
    const title = String(req.body?.title || '').trim(); const body = String(req.body?.body || '').trim();
    if (!title || !body) throw httpError(400, 'Write the title and the message');
    if (title.length > 80 || body.length > 300) throw httpError(400, 'The message is too long');
    if (!coupons.live(c, new Date())) throw httpError(409, 'This coupon is not live, so nobody can use it yet');
    res.json(await coupons.notify(c, { title, body }));
}));

module.exports = router;
