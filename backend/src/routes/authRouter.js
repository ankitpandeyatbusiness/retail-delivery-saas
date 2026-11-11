const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const User = require('../models/User');
const { wrap, httpError } = require('../middlewares/apiErrors');

const LANGUAGES = ['en', 'hi', 'bho', 'mr', 'gu', 'bn'];

// Global middleware for this router
// Refresh and logout must work even when the shop is suspended or in maintenance,
// or customers lose their login after 15 minutes.
router.use((req, res, next) => {
    if (req.path === '/refresh' || req.path === '/logout') req.allowFrozenShop = true;
    next();
});
router.use(tenantRecognizer);

// Route Definitions
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);

// ---- "Where you're logged in": the devices signed in as this person (every panel: customer, owner, kitchen, waiter, rider) ----
//   GET    /sessions                the list, this device first ({ current: true })
//   DELETE /sessions/:id            sign ONE device out
//   POST   /sessions/logout-others  sign every device out except this one
// A person only ever sees and ends their own sessions. Ending one deletes it, so its tokens stop working at once.
const mongoose = require('mongoose');
const Session = require('../models/Session');
const realtime = require('../services/realtime');
const { describeClient, describeFromUserAgent } = require('../services/clientInfo');

// a session from before the device name was kept: the name is worked out from the browser string saved with it
const shape = (s, currentId) => {
    const old = s.deviceLabel ? null : describeFromUserAgent(s.userAgent);
    return shapeRow(s, currentId, old);
};
const shapeRow = (s, currentId, old) => ({
    id: String(s._id),
    current: String(s._id) === String(currentId),
    platform: s.platform || old?.platform || 'android',   // sessions from before this list existed were all phones
    device: s.deviceLabel || old?.deviceLabel || 'Unknown device',
    city: s.city || '', region: s.region || '', country: s.country || '', place: s.place || '',
    loggedInAt: s.createdAt,
    lastActiveAt: s.lastUsedAt || s.createdAt,
});
const mine = (req) => ({ userId: req.auth.userId, tenantId: req.tenant._id, expiresAt: { $gt: new Date() } });

router.get('/sessions', authenticate, wrap(async (req, res) => {
    const rows = await Session.find(mine(req)).sort({ lastUsedAt: -1 }).limit(20).lean();
    // THIS device is asking right now, so its name is known for certain: a session that never got one is given it (and keeps it from now on)
    const here = rows.find((r) => String(r._id) === String(req.auth.sessionId));
    if (here && !here.deviceLabel) {
        const c = describeClient(req, req.ip);
        const set = { deviceLabel: c.deviceLabel, platform: c.platform, ...(c.city ? { city: c.city } : {}), ...(c.region ? { region: c.region } : {}), ...(c.country ? { country: c.country } : {}), ...(c.place ? { place: c.place } : {}) };
        Session.updateOne({ _id: here._id }, { $set: set }).catch(() => { /* the next time */ });
        Object.assign(here, set);
    }
    const items = rows.map((s) => shape(s, req.auth.sessionId));
    items.sort((a, b) => Number(b.current) - Number(a.current));
    res.json({ items });
}));

router.post('/sessions/logout-others', authenticate, wrap(async (req, res) => {
    const others = await Session.find({ ...mine(req), _id: { $ne: req.auth.sessionId } }).select('_id').lean();
    const ids = others.map((s) => s._id);
    if (ids.length) await Session.deleteMany({ _id: { $in: ids }, userId: req.auth.userId, tenantId: req.tenant._id });
    await realtime.endSessions(ids);
    res.json({ ok: true, ended: ids.length });
}));

router.delete('/sessions/:id', authenticate, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw httpError(404, 'Session not found');
    const r = await Session.findOneAndDelete({ _id: req.params.id, userId: req.auth.userId, tenantId: req.tenant._id }).select('_id').lean();
    if (!r) throw httpError(404, 'Session not found');
    await realtime.endSessions([r._id]);
    res.json({ ok: true, wasCurrent: String(r._id) === String(req.auth.sessionId) });
}));

// the language this person reads: notifications and emails to him come in it. { language: 'hi' }
router.put('/language', authenticate, wrap(async (req, res) => {
    const language = req.body?.language;
    if (!LANGUAGES.includes(language)) throw httpError(400, `language must be one of: ${LANGUAGES.join(', ')}`);
    await User.updateOne({ _id: req.auth.userId, tenantId: req.tenant._id }, { $set: { language } });
    res.json({ ok: true, language });
}));

module.exports = router;