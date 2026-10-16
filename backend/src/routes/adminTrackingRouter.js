// Live tracking of riders: how the server is doing, and the switch. Mounted inside adminRouter.
// Everybody with a superadmin login can look; only the supreme admin changes it (middlewares/supremeAdmin.js).
//   GET /api/admin/platform/tracking   { settings, status, sockets, riders, counters }
//   PUT /api/admin/platform/tracking   { mode: "socket" | "polling" | "off", maxSockets, pollSec }   or { reset: true }
//     socket   normal: sockets are accepted until maxSockets
//     polling  new sockets are refused and the apps poll every pollSec seconds (use it when the server is struggling)
//     off      no live tracking
const express = require('express');
const PlatformSettings = require('../models/PlatformSettings');
const guard = require('../services/trackingGuard');
const realtime = require('../services/realtime');
const liveTracking = require('../services/liveTracking');
const apiErrors = require('../middlewares/apiErrors');

const { wrap, httpError } = apiErrors;
const router = express.Router();

async function view() {
    const doc = await PlatformSettings.findById('main').select('tracking').lean();
    const settings = { ...guard.DEFAULTS, ...(doc?.tracking || {}) };
    const status = await guard.status();
    return { settings, status: { mode: status.mode, reason: status.reason, pollSec: status.pollSec }, sockets: realtime.connectionCount(), ridersLive: liveTracking.size(), counters: guard.stats() };
}

router.get('/platform/tracking', wrap(async (req, res) => { res.json(await view()); }));

router.put('/platform/tracking', wrap(async (req, res) => {
    const b = req.body || {};
    const set = {};
    if (b.reset === true) Object.entries(guard.DEFAULTS).forEach(([k, v]) => { set[`tracking.${k}`] = v; });
    else {
        if (b.mode !== undefined) { if (!['socket', 'polling', 'off'].includes(b.mode)) throw httpError(400, 'mode must be socket, polling or off'); set['tracking.mode'] = b.mode; }
        if (b.maxSockets !== undefined) { if (!Number.isInteger(b.maxSockets) || b.maxSockets < 10 || b.maxSockets > 5000) throw httpError(400, 'maxSockets must be a whole number from 10 to 5000'); set['tracking.maxSockets'] = b.maxSockets; }
        if (b.pollSec !== undefined) { if (!Number.isInteger(b.pollSec) || b.pollSec < 5 || b.pollSec > 120) throw httpError(400, 'pollSec must be a whole number from 5 to 120'); set['tracking.pollSec'] = b.pollSec; }
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    await PlatformSettings.findByIdAndUpdate('main', { $set: set }, { upsert: true });
    await guard.refresh();   // every connected app is told at once when the mode changes
    res.json(await view());
}));

router.use(apiErrors);
module.exports = router;
