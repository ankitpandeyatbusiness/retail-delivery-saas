// Autopilot: reminders to customers that go out by themselves. Mounted at /api/shop/autopilot (also under the superadmin shop mount).
//   GET  /            the settings, the recommended values, the safety limits
//   PUT  /            { on: { winback: true }, frequency, language, maxDiscount, quietFrom, quietTo, summaryHour, custom: { kind: { title, body } | null } }
//                     or { recommended: true }  = turn on the recommended set and put every number back
//   GET  /library     the message kinds, with a sample in the shop's language ( ?kind=winback_1&lang=hi shows one )
//   GET  /stats       ?days=30   what was sent and who came back (an order within 3 days of a message)
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const autopilot = require('../services/autopilot');
const msgs = require('../services/nudgeMessages');

const { wrap, httpError } = apiErrors;
const router = express.Router();

const NAMES = {
    welcome: 'Welcome after the first order', winback: 'Bring back customers who stopped ordering',
    mealtime: 'Meal-time reminder at their usual hour', festival: 'Festival greeting', dailySummary: 'Your daily summary', weeklyDigest: 'Your Monday digest',
};
const KIND_NAMES = {
    winback_1: 'Win-back: friendly nudge', winback_2: 'Win-back: offer', winback_3: 'Win-back: last call', welcome: 'Welcome', thanks: 'Thank you',
    mealtime_breakfast: 'Breakfast reminder', mealtime_lunch: 'Lunch reminder', mealtime_snacks: 'Snack reminder', mealtime_dinner: 'Dinner reminder',
    festival: 'Festival greeting', manual: 'Remind button',
};

// the settings plus what the screen needs to explain them
const full = (cfg) => ({
    ...cfg, recommended: autopilot.RECOMMENDED, names: NAMES,
    limits: { weeklyCap: autopilot.WEEKLY_CAP[cfg.frequency], rule: 'Nobody gets more than that many promotional messages a week, never right after an order, never at night, and a win-back stops after three messages.' },
    messages: msgs.count(),
});

router.get('/', wrap(async (req, res) => { res.json(full(await autopilot.getConfig(req.tenant._id))); }));

router.put('/', wrap(async (req, res) => {
    req.auditBefore = await autopilot.getConfig(req.tenant._id);
    res.json(full(await autopilot.saveConfig(req.tenant._id, req.body || {})));
}));

router.get('/library', wrap(async (req, res) => {
    const cfg = await autopilot.getConfig(req.tenant._id);
    const lang = msgs.LANGUAGES.includes(req.query.lang) ? req.query.lang : cfg.language;
    if (req.query.kind !== undefined && !msgs.KINDS.includes(req.query.kind)) throw httpError(400, 'Unknown message');
    const sample = (kind) => {
        const m = msgs.build({ kind, lang, custom: cfg.custom?.[kind], vars: { name: 'Rahul Sharma', shop: req.tenant.name, food: 'Paneer Roll', discount: cfg.maxDiscount || 10, code: 'BACK7K2P', festival: 'Diwali' } });
        return { title: m.title, body: m.body };
    };
    const kinds = req.query.kind ? [req.query.kind] : msgs.KINDS;
    res.json({
        language: lang, total: msgs.count(),
        items: kinds.map((kind) => ({ kind, name: KIND_NAMES[kind] || kind, variants: msgs.LIB[kind].length, sample: sample(kind), custom: cfg.custom?.[kind] || null })),
    });
}));

router.get('/stats', wrap(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    res.json(await autopilot.stats({ tenantId: req.tenant._id, days }));
}));

router.use(apiErrors);
module.exports = router;
