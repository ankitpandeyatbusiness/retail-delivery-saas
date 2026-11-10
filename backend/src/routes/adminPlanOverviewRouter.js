// Superadmin: where every shop stands on its plan, and the plan money that needs a look. Mounted inside adminRouter.
//   GET  /api/admin/plan-overview                     counts per plan and state, plans ending in 7 days, ended and paused shops, held payments, open bank disputes
//   POST /api/admin/plan-money/held/:id/apply         (supreme) apply a HELD plan payment as the owner saw it
const express = require('express');
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const PlanPayment = require('../models/PlanPayment');
const PlatformDispute = require('../models/PlatformDispute');
const planService = require('../services/planService');
const planBilling = require('../services/planBilling');
const disputes = require('../services/platformDisputes');
const { requireSupreme } = require('../middlewares/supremeAdmin');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const DAY = 86400000;

router.get('/plan-overview', wrap(async (req, res) => {
    const now = new Date();
    const shops = await Tenant.find({ 'closure.on': { $ne: true } }).select('name slug plan').lean();
    const counts = { total: shops.length, none: 0, partner: 0, growth: { active: 0, free: 0, ended: 0, paused: 0 }, pro: { active: 0, free: 0, ended: 0, paused: 0 } };
    const expiring = []; const ended = [];
    for (const t of shops) {
        const v = planService.viewOf(t, now);
        if (!v.id) { counts.none += 1; continue; }
        if (v.id === 'partner') { counts.partner += 1; continue; }
        const state = v.paused ? 'paused' : v.status;
        counts[v.id][state] = (counts[v.id][state] || 0) + 1;
        const row = { id: String(t._id), name: t.name, plan: v.id, state, endsAt: v.endsAt, daysLeft: v.daysLeft };
        if ((state === 'active' || state === 'free') && v.endsAt && new Date(v.endsAt) - now <= 7 * DAY) expiring.push(row);
        if (state === 'ended' || state === 'paused') ended.push(row);
    }
    expiring.sort((a, b) => new Date(a.endsAt) - new Date(b.endsAt));
    ended.sort((a, b) => new Date(b.endsAt || 0) - new Date(a.endsAt || 0));

    const names = async (ids) => new Map((await Tenant.find({ _id: { $in: ids } }).select('name').lean()).map((t) => [String(t._id), t.name]));
    const heldRows = await PlanPayment.find({ status: 'held' }).sort({ createdAt: -1 }).limit(30).lean();
    const dispRows = await PlatformDispute.find({ status: { $in: disputes.OPEN } }).sort({ createdAt: -1 }).limit(30).lean();
    const nm = await names([...heldRows.map((r) => r.tenantId), ...dispRows.map((d) => d.tenantId)]);
    res.json({
        counts, expiring: expiring.slice(0, 50), ended: ended.slice(0, 50),
        held: heldRows.map((r) => ({ id: String(r._id), shopId: String(r.tenantId), shop: nm.get(String(r.tenantId)) || 'A shop', to: r.to, months: r.months, payablePaise: r.payablePaise, why: r.heldWhy || '', at: r.paidAt || r.createdAt })),
        disputes: dispRows.map((d) => ({ id: String(d._id), shopId: String(d.tenantId), shop: nm.get(String(d.tenantId)) || 'A shop', kind: d.kind, status: d.status, amountPaise: d.amountPaise, respondBy: d.respondBy || null, at: d.createdAt })),
    });
}));

router.post('/plan-money/held/:id/apply', requireSupreme, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'No held payment found');
    const who = req.admin?.phone || req.admin?.email || 'supreme';
    const r = await planBilling.applyHeld(req.params.id, String(who));
    res.json({ ok: true, ...r });
}));

module.exports = router;
