// The demo panel switcher. Mounted at /api/demo. Only a DEMO session (private demo login) may use it.
//   GET  /panels            { current, panels: [{ key, label, available }] }
//   POST /switch { panel }  -> { success, slug, name, user, accessToken, refreshToken, demo: true }   (same answer as a branch switch:
//                              the app saves the login under that shop's name, makes it active and restarts)
// Customer: the shop where the demo started. Owner, Cook, Waiter, Rider: the demo shop, with pretend people.
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Session = require('../models/Session');
const PlatformSettings = require('../models/PlatformSettings');
const authController = require('../controllers/authController');
const demoTenant = require('../services/demoTenant');
const apiErrors = require('../middlewares/apiErrors');
const { hashPhone } = require('../utils/phoneHash');

const { wrap, httpError } = apiErrors;
const router = express.Router();

const dto = (u) => ({ id: u._id, phone: u.phone, name: u.name || null, role: u.role, demo: true });

router.use(tenantRecognizer);

// ---- public: the demo website's one-tap entry (no OTP, no login). Only the demo shop answers. ----
const enterLimit = require('../middlewares/publicRateLimit').make({ points: 40, duration: 60 * 60 });   // per IP, per hour
router.get('/info', wrap(async (req, res) => {
    if (!req.tenant.isDemo) throw httpError(404, 'Not found');
    res.json({ company: await demoTenant.companyInfo(), shop: req.tenant.name });
}));
router.post('/enter', enterLimit, wrap(async (req, res) => {
    if (!req.tenant.isDemo) throw httpError(403, 'The one-tap demo is only for the demo shop');
    const dt = await require('../services/demoReset').ensureReady();
    const user = await demoTenant.personFor(dt, 'customer');
    const { accessToken, refreshToken } = await authController.issueSession(user, dt, req, req.ip, { demo: true, demoHomeTenantId: dt._id });
    res.json({ success: true, demo: true, slug: dt.slug, name: dt.name, user: dto(user), accessToken, refreshToken });
}));

router.use(authenticate);
router.use((req, res, next) => (req.sessionFlags && req.sessionFlags.demo ? next() : res.status(403).json({ error: 'The demo panels are for the demo login only' })));


router.get('/panels', wrap(async (req, res) => {
    const me = await User.findById(req.auth.userId).select('role').lean();
    const dt = await require('../services/demoReset').ensureReady();
    res.json({ current: me ? me.role : 'customer', panels: await demoTenant.panelsFor(dt) });
}));

router.post('/switch', wrap(async (req, res) => {
    const panel = demoTenant.PANELS.find((p) => p.key === String(req.body?.panel || ''));
    if (!panel) throw httpError(400, 'Choose a panel');
    const dt = await require('../services/demoReset').ensureReady();
    const sess = await Session.findById(req.auth.sessionId).select('demoHomeTenantId').lean();
    const homeId = (sess && sess.demoHomeTenantId) || req.tenant._id;

    let target;
    let user;
    if (panel.key === 'customer') {
        target = String(homeId) === String(dt._id) ? dt : (await Tenant.findById(homeId)) || dt;
        if (String(target._id) === String(dt._id)) {
            user = await demoTenant.personFor(dt, 'customer');
        } else {
            // the demo phone itself is the customer of the shop where the demo started
            const demoPhone = (await PlatformSettings.findById('main').select('demo.phone').lean())?.demo?.phone;
            if (!demoPhone) throw httpError(409, 'The demo login is switched off');
            user = await User.findOneAndUpdate({ tenantId: target._id, phone: demoPhone },
                { $set: { phoneHash: hashPhone(target._id, demoPhone) } }, { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true });
            if (user.role !== 'customer') throw httpError(409, 'This number cannot be used for the demo');
        }
    } else {
        const st = (await demoTenant.panelsFor(dt)).find((p) => p.key === panel.key);
        if (!st.available) throw httpError(409, `The ${panel.label} panel is switched off for this shop`);
        target = dt;
        user = await demoTenant.personFor(dt, panel.role);
    }
    const { accessToken, refreshToken } = await authController.issueSession(user, target, req, req.ip, { demo: true, demoHomeTenantId: homeId });
    res.json({ success: true, demo: true, slug: target.slug, name: target.name, user: dto(user), accessToken, refreshToken });
}));

// put the demo shop back to the start (at most once a minute). Real shops are never touched.
router.post('/reset', wrap(async (req, res) => {
    try { res.json(await require('../services/demoReset').reset()); } catch (e) { throw e.status ? httpError(e.status, e.message) : e; }
}));

router.use(apiErrors);
module.exports = router;
