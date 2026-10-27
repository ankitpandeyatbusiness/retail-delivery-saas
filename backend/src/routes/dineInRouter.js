// The customer's table bill.   GET /api/dinein/bill  ->  { open: false } | { open: true, table, status, rounds, total, due, ... }
//                              POST /api/dinein/ask-bill
const express = require('express');
const tenantRecognizer = require('../middlewares/tenantRecognizer');
const authenticate = require('../middlewares/authMiddleware');
const apiErrors = require('../middlewares/apiErrors');
const tableBill = require('../services/tableBill');
const tableQr = require('../services/tableQr');
const Tenant = require('../models/Tenant');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const page = (res, html) => res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" }).send(html);

// ---- public pages (a phone camera opens these, no login) ----
// what a table QR opens: a page that hands over to the shop's app, or the Play Store
router.get('/t/:slug/:table', wrap(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    const table = String(req.params.table);
    const t = SLUG_RE.test(slug) ? await Tenant.findOne({ slug }).select('name slug androidPackage settings').lean() : null;
    if (!t || !/^\d{1,3}$/.test(table) || !tableQr.check(t._id, 'table:' + table, req.query.k)) return res.status(404).send('This QR code is not valid.');
    tableBill.recordScan({ tenantId: t._id, table, key: req.ip, source: 'link' });
    page(res, tableQr.landingHtml({ t, table, k: String(req.query.k), scheme: t.slug }));
}));
// all the stickers, ready to print (the link comes from the owner's app)
router.get('/print/:slug', wrap(async (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    const t = SLUG_RE.test(slug) ? await Tenant.findOne({ slug }).select('name slug settings').lean() : null;
    if (!t || !tableQr.check(t._id, 'print', req.query.k)) return res.status(404).send('This link is not valid.');
    page(res, await tableQr.printHtml(req, t, true, String(req.query.size || '')));
}));

router.use(tenantRecognizer);
// the app checks a scanned code before it sets the table (no login needed to look around)
router.post('/scan', wrap(async (req, res) => {
    const table = String(req.body?.table || '');
    const d = { ...require('../services/tenantConfigService').DEFAULTS.orders.dineIn, ...(req.tenant.settings?.orders?.dineIn || {}) };
    if (!d.enabled) throw httpError(400, 'This shop is not taking dine in orders right now');
    if (!/^\d{1,3}$/.test(table) || Number(table) < 1 || Number(table) > d.tableCount || !tableQr.check(req.tenant._id, 'table:' + table, req.body?.k)) throw httpError(400, 'This QR code is not valid');
    tableBill.recordScan({ tenantId: req.tenant._id, table, key: req.ip, source: 'app' });
    res.json({ ok: true, table });
}));
// is the shop full right now (the app shows "it may take longer")
router.get('/status', wrap(async (req, res) => {
    res.json(await tableBill.estimate(req.tenant));   // { busy, extraMin, waitMin }
}));
router.use(authenticate);

// offers he can get, and his usual (what he had last time)
router.get('/offers', wrap(async (req, res) => {
    const config = require('../services/tenantConfigService').resolveConfig(req.tenant);
    res.json({ items: await require('../services/dineOffers').describe({ tenant: req.tenant, config, userId: req.auth.userId }) });
}));
router.get('/usual', wrap(async (req, res) => {
    res.json({ usual: await require('../services/dineOffers').usual({ tenant: req.tenant, userId: req.auth.userId }) });
}));

// shared tables: who is at this table and what the guest can do · his choice (separate bill, or join them) · the answers
const shared = require('../services/sharedTables');
const sharedGuard = (e) => { throw httpError(e.status || 400, e.message); };
router.get('/table/:table', wrap(async (req, res) => { res.json(await shared.stateAt({ tenant: req.tenant, userId: req.auth.userId, table: String(req.params.table) })); }));
router.post('/table/:table/enter', wrap(async (req, res) => {
    try { res.json(await shared.enter({ tenant: req.tenant, userId: req.auth.userId, table: String(req.params.table), choice: req.body?.choice, sessionId: req.body?.sessionId })); } catch (e) { if (e.extra) throw e; sharedGuard(e); }
}));
router.get('/joins', wrap(async (req, res) => { res.json({ items: await shared.pendingFor({ tenant: req.tenant, userId: req.auth.userId }) }); }));
router.get('/join/:id', wrap(async (req, res) => { try { res.json(await shared.joinStatus({ tenant: req.tenant, userId: req.auth.userId, joinId: req.params.id })); } catch (e) { sharedGuard(e); } }));
router.post('/join/:id/answer', wrap(async (req, res) => { try { res.json(await shared.answerJoin({ tenant: req.tenant, userId: req.auth.userId, joinId: req.params.id, approve: req.body?.approve, block: req.body?.block === true })); } catch (e) { sharedGuard(e); } }));
router.post('/join/:id/pin', wrap(async (req, res) => { try { res.json(await shared.enterPin({ tenant: req.tenant, userId: req.auth.userId, joinId: req.params.id, pin: req.body?.pin })); } catch (e) { sharedGuard(e); } }));

// the guest's app says where he stands, and he asks to pay his share and leave
router.post('/presence', wrap(async (req, res) => { res.json(await require('../services/guestWatch').report({ tenantId: req.tenant._id, userId: req.auth.userId, loc: req.body?.loc })); }));
router.post('/leave-ask', wrap(async (req, res) => {
    try { res.json(await require('../services/tableShares').askLeave({ tenant: req.tenant, userId: req.auth.userId })); } catch (e) { throw httpError(e.status || 400, e.message); }
}));

router.get('/bill', wrap(async (req, res) => {
    const [s, owed] = await Promise.all([tableBill.openFor(req.tenant._id, req.auth.userId), tableBill.owedBy(req.tenant._id, req.auth.userId)]);
    if (s) return res.json({ open: true, ...(await tableBill.billOf(s)), owed, payOnline: await require('../services/tablePayment').available(req.tenant._id) });
    res.json({ open: false, owed, feedbackDue: await tableBill.feedbackDue(req.tenant, req.auth.userId).catch(() => null) });
}));

// refer a friend: my code, and typing a friend's code
router.get('/referral', wrap(async (req, res) => { res.json(await require('../services/referral').me({ tenant: req.tenant, userId: req.auth.userId })); }));
router.post('/referral/apply', wrap(async (req, res) => {
    try { res.json(await require('../services/referral').apply({ tenant: req.tenant, userId: req.auth.userId, code: req.body?.code })); } catch (e) { throw httpError(e.status || 400, e.message); }
}));

// call the waiter / ask for water...; the tip; private feedback after the meal
router.post('/call', wrap(async (req, res) => {
    try { res.json(await tableBill.callWaiter({ tenant: req.tenant, userId: req.auth.userId, kind: req.body?.kind, text: req.body?.text, table: req.body?.table })); } catch (e) { throw httpError(e.status || 400, e.message); }
}));
router.post('/tip', wrap(async (req, res) => {
    try { res.json({ open: true, ...(await tableBill.setTip({ tenant: req.tenant, userId: req.auth.userId, amount: req.body?.amount })) }); } catch (e) { throw httpError(e.status || 400, e.message); }
}));
router.post('/feedback', wrap(async (req, res) => {
    const b = req.body || {};
    try { res.json(await tableBill.submitFeedback({ tenant: req.tenant, userId: req.auth.userId, sessionId: b.sessionId, stars: b.stars, tags: b.tags, comment: b.comment })); } catch (e) { throw httpError(e.status || 400, e.message); }
}));

// Pay the bill he left unpaid, online (the shop's own Razorpay keys)
router.post('/owed/pay', wrap(async (req, res) => { res.json(await require('../services/owedPayment').start({ tenantId: req.tenant._id, userId: req.auth.userId, scope: req.body?.scope === 'mine' ? 'mine' : 'all' })); }));
router.post('/owed/pay/check', wrap(async (req, res) => {
    let r;
    try { r = await require('../services/owedPayment').check({ tenantId: req.tenant._id, userId: req.auth.userId }); } catch (e) { r = { paid: false, status: 'unknown' }; }
    res.json(r);
}));
router.post('/owed/pay/verify', wrap(async (req, res) => {
    const b = req.body || {};
    const [rzpOrderId, rzpPaymentId, signature] = [b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature];
    if (![rzpOrderId, rzpPaymentId, signature].every((v) => typeof v === 'string' && v && v.length <= 100)) throw httpError(400, 'Payment details are missing');
    const r = await require('../services/owedPayment').verify({ tenantId: req.tenant._id, userId: req.auth.userId, rzpOrderId, rzpPaymentId, signature });
    res.json({ paid: !!r.paid });
}));

// Pay what he has ordered so far, online, from the table (the shop's own Razorpay keys). The visit stays open.
router.post('/pay-bill', wrap(async (req, res) => { res.json(await require('../services/tablePayment').start({ tenantId: req.tenant._id, userId: req.auth.userId })); }));
router.post('/pay-bill/check', wrap(async (req, res) => {
    let r;
    try { r = await require('../services/tablePayment').check({ tenantId: req.tenant._id, userId: req.auth.userId }); } catch (e) { r = { paid: false, status: 'unknown' }; }
    res.json(r);
}));
router.post('/pay-bill/verify', wrap(async (req, res) => {
    const b = req.body || {};
    const [rzpOrderId, rzpPaymentId, signature] = [b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature];
    if (![rzpOrderId, rzpPaymentId, signature].every((v) => typeof v === 'string' && v && v.length <= 100)) throw httpError(400, 'Payment details are missing');
    const r = await require('../services/tablePayment').verify({ tenantId: req.tenant._id, userId: req.auth.userId, rzpOrderId, rzpPaymentId, signature });
    res.json({ paid: !!r.paid });
}));

// "I already paid" (for a bill he left unpaid): the owner is asked to confirm
router.post('/paid-claim', wrap(async (req, res) => {
    try { res.json(await tableBill.claimPaid({ tenantId: req.tenant._id, userId: req.auth.userId })); } catch (e) { throw httpError(e.status || 400, e.message); }
}));

router.post('/nudge', wrap(async (req, res) => {
    try { res.json(await tableBill.nudge({ tenantId: req.tenant._id, userId: req.auth.userId })); } catch (e) { throw httpError(e.status || 400, e.message); }
}));

// "I am done": the guest frees the table once everything is paid (everyone on his bill is told)
router.post('/free', wrap(async (req, res) => {
    const s = await tableBill.openFor(req.tenant._id, req.auth.userId);
    if (!s) throw httpError(404, 'You have no open table');
    const r = await tableBill.freeTable(s, 'customer');
    if (!r.ok) throw httpError(409, r.reason === 'unpaid' ? 'Please pay your bill first.' : r.reason === 'busy' ? 'Your food is still being made or served.' : r.reason === 'nothing' ? 'You have not ordered anything.' : 'This table is already free.');
    res.json({ ok: true });
}));

router.post('/ask-bill', wrap(async (req, res) => {
    try { res.json({ open: true, ...(await tableBill.askForBill({ tenantId: req.tenant._id, userId: req.auth.userId })) }); } catch (e) { throw httpError(e.status || 400, e.message); }
}));

router.use(apiErrors);
module.exports = router;
