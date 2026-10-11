// Superadmin: change how an event is delivered, without a deploy. Mounted inside adminRouter.
//   GET /api/admin/notification-rules   every event with its default, and the rules you saved
//   PUT /api/admin/notification-rules   { eventKey, tenantId?, enabled?, channels?, alsoPush?, escalateSmsAfterSec?, reset? }
//       no tenantId = every shop, with tenantId = that shop only (it wins).
//       a field set to null goes back to the default. reset: true removes the rule.
const express = require('express');
const mongoose = require('mongoose');
const apiErrors = require('../middlewares/apiErrors');
const NotificationRule = require('../models/NotificationRule');
const Tenant = require('../models/Tenant');
const rules = require('../notifications/rules');
const { EVENTS } = require('../notifications/events');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);
const CHANNELS = ['inapp', 'push', 'sms'];

router.get('/notification-rules', wrap(async (req, res) => {
    const saved = await NotificationRule.find({}).sort({ eventKey: 1 }).lean();
    res.json({
        events: Object.entries(EVENTS).map(([eventKey, e]) => ({
            eventKey, to: e.to, channels: e.channels, alsoPush: !!e.alsoPush,
            escalateSmsAfterSec: e.escalateSmsAfterSec || null,
            smsKeyEvent: typeof e.key === 'function' ? 'some' : !!e.key,
            email: e.email || null, adminAlert: e.adminAlert || null, critical: !!e.critical,
        })),
        rules: saved,
    });
}));

router.put('/notification-rules', wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.eventKey !== 'string' || !EVENTS[b.eventKey]) throw httpError(404, 'Unknown event');
    let tenantId = null;
    if (b.tenantId !== undefined && b.tenantId !== null) {
        if (!isId(b.tenantId) || !(await Tenant.exists({ _id: b.tenantId }))) throw httpError(404, 'Shop not found');
        tenantId = b.tenantId;
    }
    const key = { eventKey: b.eventKey, tenantId };
    req.auditBefore = (await NotificationRule.findOne(key).lean()) || undefined;

    if (b.reset === true) {
        await NotificationRule.deleteOne(key);
        rules.invalidate();
        return res.json({ ok: true, rule: null });
    }

    const set = {};
    const unset = {};
    const put = (name, value) => { if (value === null) unset[name] = 1; else set[name] = value; };
    if (b.enabled !== undefined) {
        if (b.enabled !== null && typeof b.enabled !== 'boolean') throw httpError(400, 'enabled must be true or false');
        put('enabled', b.enabled);
    }
    if (b.alsoPush !== undefined) {
        if (b.alsoPush !== null && typeof b.alsoPush !== 'boolean') throw httpError(400, 'alsoPush must be true or false');
        put('alsoPush', b.alsoPush);
    }
    if (b.escalateSmsAfterSec !== undefined) {
        const v = b.escalateSmsAfterSec;
        if (v !== null && (!Number.isInteger(v) || v < 0 || v > 86400)) throw httpError(400, 'escalateSmsAfterSec must be a whole number from 0 to 86400');
        put('escalateSmsAfterSec', v);
    }
    if (b.channels !== undefined) {
        if (b.channels !== null && (!Array.isArray(b.channels) || !b.channels.every((c) => CHANNELS.includes(c)))) {
            throw httpError(400, `channels must be a list of: ${CHANNELS.join(', ')}`);
        }
        put('channels', b.channels === null ? null : [...new Set(b.channels)]);
    }
    if (!Object.keys(set).length && !Object.keys(unset).length) throw httpError(400, 'Nothing to change');

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    const rule = await NotificationRule.findOneAndUpdate(key, update, { upsert: true, returnDocument: 'after' }).lean();
    rules.invalidate();
    res.json({ ok: true, rule });
}));

router.use(apiErrors);
module.exports = router;