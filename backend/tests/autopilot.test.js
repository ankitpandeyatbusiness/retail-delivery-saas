require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const NudgeLog = require('../src/models/NudgeLog');
const Coupon = require('../src/models/Coupon');
const PlatformSettings = require('../src/models/PlatformSettings');
const insights = require('../src/services/customerInsights');
const autopilot = require('../src/services/autopilot');
const msgs = require('../src/services/nudgeMessages');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');

// Customer profiles, the message library, the one-tap Remind and the Autopilot (push and inbox only, with its safety limits).
let w;
before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld('auto-shop');
    tenantRecognizer.invalidateTenant('auto-shop');
});

const DAY = 86400000;
// 12:30 pm in India. The clock of every call below is passed in, so the tests never depend on the time of day they run.
const NOW = new Date('2026-10-14T07:00:00Z');
const at = (daysAgo, istHour = 13) => new Date(Date.parse(`2026-10-14T00:00:00+05:30`) - daysAgo * DAY + istHour * 3600000 + 5 * 60000);
const shop = () => ({ _id: w.tenant._id, name: 'Savera' });
let phone = 9100000000;
const customer = (name, extra = {}) => User.create({ tenantId: w.tenant._id, phone: String(++phone), role: 'customer', name, ...extra });
const order = (user, when, name = 'Paneer Roll', qty = 1) => f.makeOrder(w.tenant, user, {
    status: 'delivered', createdAt: when, deliveredAt: new Date(when.getTime() + 40 * 60000),
    items: [{ productId: w.tenant._id, name, quantity: qty, unitPrice: 100, lineTotal: 100 * qty }], pricing: { subtotal: 100 * qty, total: 100 * qty },
});
const orders = async (user, days, name) => { for (const d of days) await order(user, at(d), name); };
const inbox = (user, type) => Notification.find({ tenantId: w.tenant._id, userId: user._id, ...(type ? { type } : {}) }).lean();
const cfgOn = async (patch = {}) => autopilot.saveConfig(w.tenant._id, patch);
const run = async (now = NOW) => autopilot.runForTenant(shop(), await autopilot.getConfig(w.tenant._id), now);
const get = (url) => request(app).get(url).set(w.owner.headers);
const put = (url, body) => request(app).put(url).set(w.owner.headers).send(body);
const post = (url, body) => request(app).post(url).set(w.owner.headers).send(body);

describe('customer profiles', () => {
    test('tags, usual time and favourite food', async () => {
        const fresh = await customer('Fresh');
        await order(fresh, at(2));
        const slipping = await customer('Slipping');
        await orders(slipping, [47, 40, 33], 'Samosa');     // every week, last seen 33 days ago
        const lost = await customer('Lost');
        await order(lost, at(100));
        const vip = await customer('Vip');
        await orders(vip, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21], 'Biryani');
        const regular = await customer('Regular');
        await orders(regular, [10, 6, 2]);

        const p = await insights.build({ tenantId: w.tenant._id, now: NOW });
        assert.equal(p.get(String(fresh._id)).tag, 'new');
        assert.equal(p.get(String(slipping._id)).tag, 'slipping');
        assert.equal(p.get(String(lost._id)).tag, 'lost');
        assert.equal(p.get(String(vip._id)).tag, 'vip');
        assert.equal(p.get(String(regular._id)).tag, 'regular');
        const v = p.get(String(vip._id));
        assert.equal(v.usualHour, 13);
        assert.equal(v.usualHourLabel, '1 PM');
        assert.equal(v.favourites[0].name, 'Biryani');
        assert.equal(v.favouriteBySlot.lunch, 'Biryani');
        assert.equal(v.orders, 11);
    });

    test('the list API: counts, filter, search, and who can be reached', async () => {
        const a = await customer('Asha Rao');
        await orders(a, [47, 40, 33]);
        const b = await customer('Bela Das', { prefs: { promotions: false } });
        await order(b, at(2));
        const r = await get('/api/shop/customers/insights');
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.total, 2);
        assert.equal(r.body.counts.slipping, 1);
        assert.equal(r.body.counts.new, 1);
        const only = await get('/api/shop/customers/insights?tag=slipping');
        assert.deepEqual(only.body.items.map((x) => x.name), ['Asha Rao']);
        const found = await get('/api/shop/customers/insights?q=bela');
        assert.equal(found.body.items[0].reachable, false);
        assert.match(found.body.items[0].reachNote, /turned off/);
        const one = await get(`/api/shop/customers/${a._id}/insight`);
        assert.equal(one.body.tag, 'slipping');
        assert.equal((await request(app).get(`/api/shop/customers/${w.customer.user._id}/insight`).set(w.owner.headers)).status, 200);
        assert.notEqual((await request(app).get('/api/shop/customers/insights')).status, 200);
    });
});

describe('the message library', () => {
    test('every message has all three languages, fills every word and never shows a bare {word}', () => {
        assert.ok(msgs.count() >= 55, `only ${msgs.count()} messages`);
        const known = new Set(['name', 'food', 'shop', 'discount', 'code', 'festival']);
        for (const kind of msgs.KINDS) {
            for (const m of msgs.LIB[kind]) {
                for (const lang of msgs.LANGUAGES) {
                    assert.equal(m[lang].length, 2, `${kind} ${lang}`);
                    for (const text of m[lang]) for (const x of text.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(x[1]), `${kind} ${lang}: {${x[1]}}`);
                }
            }
            for (const lang of msgs.LANGUAGES) {
                const m = msgs.build({ kind, lang, vars: { name: '', shop: 'Savera', discount: 10, code: 'BACK1', festival: 'Diwali' } });
                assert.doesNotMatch(`${m.title} ${m.body}`, /[{}]|undefined|null/);
                assert.ok(m.title.length > 0 && m.body.length > 0 && m.title.length <= 60, `${kind} ${lang} title`);
            }
        }
        for (let i = 0; i < 12; i += 1) { const m = msgs.build({ kind: 'welcome', lang: 'hi', vars: { name: 'Ravi Kumar', shop: 'Savera' } }); assert.match(`${m.title} ${m.body}`, /Ravi/); assert.doesNotMatch(`${m.title} ${m.body}`, /Kumar/); }
    });

    test('a message is not repeated until the others were used, and the owner\'s own words win', () => {
        const seen = new Set();
        let avoid = [];
        for (let i = 0; i < msgs.LIB.welcome.length; i += 1) {
            const m = msgs.build({ kind: 'welcome', lang: 'en', avoid, vars: { name: 'A', shop: 'S' } });
            assert.ok(!seen.has(m.idx));
            seen.add(m.idx); avoid = [...seen];
        }
        const own = msgs.build({ kind: 'welcome', lang: 'en', custom: { title: 'Hi {name}!', body: 'Welcome to {shop}.' }, vars: { name: 'Ravi Kumar', shop: 'Savera' } });
        assert.deepEqual([own.title, own.body, own.idx], ['Hi Ravi!', 'Welcome to Savera.', -1]);
    });
});

describe('the settings', () => {
    test('nothing is on until the owner turns it on; recommended and reset', async () => {
        const g = await get('/api/shop/autopilot');
        assert.equal(g.status, 200);
        assert.ok(Object.values(g.body.on).every((v) => v === false));
        assert.equal(g.body.frequency, 'gentle');
        assert.equal(g.body.language, 'hinglish');
        assert.equal(g.body.limits.weeklyCap, 2);

        const rec = await put('/api/shop/autopilot', { recommended: true });
        assert.equal(rec.body.on.winback, true);
        assert.equal(rec.body.limits.weeklyCap, 2);   // a save returns the same shape as a read
        assert.equal(rec.body.on.mealtime, false);
        const changed = await put('/api/shop/autopilot', { frequency: 'pushy', language: 'hi', maxDiscount: 25, on: { mealtime: true } });
        assert.equal(changed.body.frequency, 'pushy');
        assert.equal(changed.body.on.mealtime, true);
        const back = await put('/api/shop/autopilot', { recommended: true });
        assert.equal(back.body.frequency, 'gentle');
        assert.equal(back.body.language, 'hinglish');
        assert.equal(back.body.maxDiscount, 10);
        assert.equal(back.body.on.mealtime, false);
    });

    test('bad input is refused', async () => {
        for (const body of [{}, { frequency: 'loud' }, { language: 'fr' }, { maxDiscount: 90 }, { quietFrom: 25 }, { on: { spam: true } }, { on: { winback: 'yes' } }, { custom: { nope: { title: 'a', body: 'b' } } }, { custom: { welcome: { title: '', body: 'b' } } }]) {
            assert.equal((await put('/api/shop/autopilot', body)).status, 400, JSON.stringify(body));
        }
    });

    test('the owner\'s own wording is shown in the library and can be removed', async () => {
        await put('/api/shop/autopilot', { language: 'en', custom: { welcome: { title: 'Hello {name}', body: 'Glad you came to {shop}.' } } });
        const lib = await get('/api/shop/autopilot/library?kind=welcome');
        assert.equal(lib.body.items[0].sample.title, 'Hello Rahul');
        assert.equal(lib.body.items[0].custom.title, 'Hello {name}');
        await put('/api/shop/autopilot', { custom: { welcome: null } });
        assert.equal((await get('/api/shop/autopilot/library?kind=welcome')).body.items[0].custom, null);
        assert.equal((await get('/api/shop/autopilot/library')).body.items.length, msgs.KINDS.length);
    });
});

describe('Remind (one tap)', () => {
    test('shows the message first, sends it to the inbox, and keeps to the limits', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33], 'Samosa');
        await cfgOn({ language: 'en' });

        const prev = await autopilot.previewRemind({ tenant: shop(), userId: String(c._id), now: NOW });
        assert.equal(prev.canSend, true);
        assert.match(prev.body + prev.title, /Samosa|Asha/);

        const sent = await autopilot.remind({ tenant: shop(), userId: String(c._id), now: NOW });
        assert.equal(sent.ok, true);
        const rows = await inbox(c, 'shop_nudge');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].data.kind, 'nudge');
        assert.equal(await NudgeLog.countDocuments({ userId: c._id, kind: 'manual', by: 'owner' }), 1);

        await assert.rejects(autopilot.remind({ tenant: shop(), userId: String(c._id), now: new Date(NOW.getTime() + DAY) }), /recently/);   // not again within 3 days
        assert.equal((await inbox(c, 'shop_nudge')).length, 1);
    });

    test('the owner can edit the words; text is checked', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        await assert.rejects(autopilot.remind({ tenant: shop(), userId: String(c._id), title: '', body: 'x', now: NOW }), /title/);
        await autopilot.remind({ tenant: shop(), userId: String(c._id), title: 'Come back!', body: 'Biryani is on.', now: NOW });
        const row = (await inbox(c, 'shop_nudge'))[0];
        assert.equal(row.title, 'Come back!');
    });

    test('never to a blocked customer, one who turned off offers, one who ordered today, or at night', async () => {
        const off = await customer('Off', { prefs: { promotions: false } });
        const blocked = await customer('Blocked', { isBlocked: true });
        const today = await customer('Today');
        await order(today, new Date(NOW.getTime() - 3 * 3600000));
        const ok = await customer('Ok');
        await orders(ok, [47, 40, 33]);
        for (const u of [off, blocked, today]) {
            await orders(u, [60]);
            await assert.rejects(autopilot.remind({ tenant: shop(), userId: String(u._id), now: NOW }), (e) => e.status === 409);
        }
        const night = new Date('2026-10-14T20:00:00Z');   // 1:30 am in India
        await assert.rejects(autopilot.remind({ tenant: shop(), userId: String(ok._id), now: night }), /quiet time/);
        assert.equal(await NudgeLog.countDocuments({}), 0);
    });

    test('with an offer a one-use coupon is made and its code is in the message', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        await cfgOn({ language: 'en', maxDiscount: 15 });
        const r = await autopilot.remind({ tenant: shop(), userId: String(c._id), withOffer: true, now: NOW });
        assert.match(r.couponCode, /^BACK/);
        assert.match(r.body, new RegExp(r.couponCode));
        const coupon = await Coupon.findOne({ tenantId: w.tenant._id, code: r.couponCode }).lean();
        assert.equal(coupon.discountValue, 15);
        assert.equal(coupon.totalUsageLimit, 1);
        assert.equal(coupon.isPublic, false);
    });

    test('the HTTP routes', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        const prev = await get(`/api/shop/customers/${c._id}/remind`);
        assert.equal(prev.status, 200, JSON.stringify(prev.body));
        assert.ok(prev.body.title && prev.body.body);
        assert.equal((await get('/api/shop/customers/000000000000000000000000/remind')).status, 404);
        assert.notEqual((await request(app).post(`/api/shop/customers/${c._id}/remind`).send({})).status, 200);
    });
});

describe('Autopilot', () => {
    test('a win-back sequence: nudge, offer, last call, then a rest. Never at the wrong hour, never again', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33], 'Samosa');          // orders around 1 pm: nudged at noon
        await cfgOn({ on: { winback: true }, language: 'en' });

        assert.equal((await run(new Date('2026-10-14T09:30:00Z'))).customers, 0);   // 3 pm: not her hour
        assert.equal((await run()).customers, 1);                                    // 12:30 pm
        assert.equal((await run()).customers, 0);                                    // the same hour again: nothing
        let logs = await NudgeLog.find({ userId: c._id }).sort({ createdAt: 1 }).lean();
        assert.deepEqual(logs.map((l) => l.kind), ['winback_1']);
        assert.match(logs[0].body, /Samosa|favourite/i);

        assert.equal((await run(new Date(NOW.getTime() + 3 * DAY))).customers, 0);   // gentle: 7 days between steps
        await run(new Date(NOW.getTime() + 8 * DAY));
        logs = await NudgeLog.find({ userId: c._id }).sort({ createdAt: 1 }).lean();
        assert.deepEqual(logs.map((l) => l.kind), ['winback_1', 'winback_2']);
        assert.match(logs[1].couponCode, /^BACK/);
        assert.match(logs[1].body, new RegExp(logs[1].couponCode));
        await run(new Date(NOW.getTime() + 16 * DAY));
        await run(new Date(NOW.getTime() + 30 * DAY));                               // resting
        await run(new Date(NOW.getTime() + 40 * DAY));
        assert.deepEqual((await NudgeLog.find({ userId: c._id }).sort({ createdAt: 1 }).lean()).map((l) => l.kind), ['winback_1', 'winback_2', 'winback_3']);
        assert.equal((await inbox(c, 'shop_nudge')).length, 3);
    });

    test('the offer step with no discount allowed sends a plain reminder and makes no coupon', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        await cfgOn({ on: { winback: true }, language: 'en', maxDiscount: 0 });
        await run();
        await run(new Date(NOW.getTime() + 8 * DAY));
        assert.equal(await Coupon.countDocuments({ tenantId: w.tenant._id }), 0);
        assert.equal(await NudgeLog.countDocuments({ userId: c._id }), 2);
    });

    test('pushy is quicker than gentle', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        await cfgOn({ on: { winback: true }, frequency: 'pushy' });
        await run();
        await run(new Date(NOW.getTime() + 2 * DAY));
        assert.equal(await NudgeLog.countDocuments({ userId: c._id }), 2);
    });

    test('safety: no offers-off customers, nobody blocked, nothing at night, and an order stops it', async () => {
        const off = await customer('Off', { prefs: { promotions: false } });
        const blocked = await customer('Blocked', { isBlocked: true });
        const ok = await customer('Ok');
        for (const u of [off, blocked, ok]) await orders(u, [47, 40, 33]);
        await cfgOn({ on: { winback: true }, quietFrom: 11, quietTo: 14 });
        assert.equal((await run()).customers, 0);                    // 12:30 pm is now quiet time
        await cfgOn({ quietFrom: 21, quietTo: 9 });
        assert.equal((await run()).customers, 1);                    // only "Ok"
        assert.equal(await NudgeLog.countDocuments({ userId: ok._id }), 1);

        await order(ok, new Date(NOW.getTime() + DAY));              // he came back
        await run(new Date(NOW.getTime() + 8 * DAY));
        assert.equal(await NudgeLog.countDocuments({ userId: ok._id }), 1);   // the sequence ended with his order
    });

    test('welcome after a first order, thanks after later ones, each once', async () => {
        const first = await customer('First');
        await order(first, new Date(NOW.getTime() - 2 * 3600000));
        const again = await customer('Again');
        await orders(again, [6, 2]);
        await order(again, new Date(NOW.getTime() - 2 * 3600000));
        await cfgOn({ on: { welcome: true, thanks: true }, language: 'en' });
        assert.equal((await run()).customers, 2);
        assert.equal((await run()).customers, 0);
        assert.equal((await NudgeLog.findOne({ userId: first._id })).kind, 'welcome');
        assert.equal((await NudgeLog.findOne({ userId: again._id })).kind, 'thanks');
        assert.equal((await NudgeLog.findOne({ userId: first._id })).promo, false);
    });

    test('meal-time reminder uses the food he orders at that part of the day', async () => {
        const c = await customer('Regular');
        for (const d of [12, 9, 6, 3]) await order(c, at(d, 13), 'Thali');
        for (const d of [11, 5]) await order(c, at(d, 21), 'Pizza');
        await cfgOn({ on: { mealtime: true }, language: 'en' });
        await run(new Date('2026-10-14T06:30:00Z'));   // 12:00 pm, the hour before 1 pm
        const log = await NudgeLog.findOne({ userId: c._id });
        assert.equal(log.kind, 'mealtime');
        assert.match(log.body + log.title, /Thali/);
    });

    test('the festival greeting goes once on the day', async () => {
        const c = await customer('Regular');
        await orders(c, [10, 5]);
        await cfgOn({ on: { festival: true } });
        assert.equal((await run(NOW)).customers, 0);                                        // an ordinary day
        const diwali = new Date('2026-11-08T05:45:00Z');                                    // 11:15 am
        assert.equal((await autopilot.runForTenant(shop(), await autopilot.getConfig(w.tenant._id), diwali)).customers, 1);
        assert.equal((await autopilot.runForTenant(shop(), await autopilot.getConfig(w.tenant._id), diwali)).customers, 0);
        assert.match((await NudgeLog.findOne({ userId: c._id })).title + (await NudgeLog.findOne({ userId: c._id })).body, /Diwali/);
    });

    test('the owner\'s daily summary comes once, at his hour, only when there were orders', async () => {
        await cfgOn({ on: { dailySummary: true }, summaryHour: 22 });
        const night = new Date('2026-10-14T16:45:00Z');   // 10:15 pm
        assert.equal((await autopilot.runForTenant(shop(), await autopilot.getConfig(w.tenant._id), night)).owner, 0);   // no orders today
        const c = await customer('Asha');
        await order(c, new Date('2026-10-14T10:00:00Z'));
        assert.equal((await autopilot.runForTenant(shop(), await autopilot.getConfig(w.tenant._id), night)).owner, 1);
        assert.equal((await autopilot.runForTenant(shop(), await autopilot.getConfig(w.tenant._id), night)).owner, 0);
        const rows = await Notification.find({ tenantId: w.tenant._id, role: 'owner', type: 'owner_daily_summary' }).lean();
        assert.equal(rows.length, 1);
        assert.match(rows[0].title, /₹100 from 1 order/);
    });

    test('the platform can switch it off for a shop or for everybody', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        await cfgOn({ on: { winback: true } });
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'insights.autopilotEnabled': false } }, { upsert: true });
        assert.equal((await autopilot.runAll(NOW)).off, true);
        assert.equal(await NudgeLog.countDocuments({}), 0);
        await PlatformSettings.findByIdAndUpdate('main', { $set: { 'insights.autopilotEnabled': true } });
        await require('../src/models/Autopilot').updateOne({ tenantId: w.tenant._id }, { $set: { platformPaused: true } });
        assert.equal((await autopilot.runAll(NOW)).shops, 0);
        await require('../src/models/Autopilot').updateOne({ tenantId: w.tenant._id }, { $set: { platformPaused: false } });
        assert.equal((await autopilot.runAll(NOW)).customers, 1);
    });

    test('what it brought back: an order within 3 days of a message', async () => {
        const c = await customer('Asha Rao');
        await orders(c, [47, 40, 33]);
        const d = await customer('Dev');
        await orders(d, [47, 40, 33]);
        await cfgOn({ on: { winback: true } });
        await run();
        await order(c, new Date(NOW.getTime() + DAY));            // came back the next day
        await order(d, new Date(NOW.getTime() + 6 * DAY));        // too late to count
        const s = await autopilot.stats({ tenantId: w.tenant._id, days: 30, now: new Date(NOW.getTime() + 7 * DAY) });
        assert.equal(s.sent, 2);
        assert.equal(s.broughtBack, 1);
        assert.equal(s.revenue, 100);
        assert.equal(s.byKind.winback.orders, 1);
        const api = await get('/api/shop/autopilot/stats');
        assert.equal(api.status, 200);
        assert.ok(api.body.recent.length >= 0);
    });
});

describe('superadmin: shops growth and the per-shop stop', () => {
    test('leaderboard, growing and slowing, and pausing one shop', async () => {
        const { token } = await f.makeSuperAdmin();
        const auth = { Authorization: `Bearer ${token}` };
        const c = await customer('Asha');
        for (const d of [1, 2, 3]) await order(c, new Date(Date.now() - d * DAY));
        await order(c, new Date(Date.now() - 40 * DAY));
        const r = await request(app).get('/api/admin/platform/shops-growth').set(auth);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        const me = r.body.leaderboard.find((s) => s.slug === 'auto-shop');
        assert.equal(me.revenue, 300);
        assert.equal(me.change, 200);
        assert.equal(me.status, 'growing');
        assert.equal(r.body.growing[0].slug, 'auto-shop');
        assert.equal(r.body.totals.revenue, 300);

        const p = await request(app).put(`/api/admin/tenants/${w.tenant._id}/autopilot`).set(auth).send({ paused: true });
        assert.equal(p.status, 200, JSON.stringify(p.body));
        const g = await request(app).get(`/api/admin/tenants/${w.tenant._id}/autopilot`).set(auth);
        assert.equal(g.body.platformPaused, true);
        assert.equal((await request(app).put(`/api/admin/tenants/${w.tenant._id}/autopilot`).set(auth).send({ paused: 'yes' })).status, 400);
        const k = await request(app).put('/api/admin/platform/insights').set(auth).send({ autopilotEnabled: false });
        assert.equal(k.body.autopilotEnabled, false);
        assert.equal((await request(app).put('/api/admin/platform/insights').set(auth).send({ reset: true })).body.autopilotEnabled, true);
    });
});
