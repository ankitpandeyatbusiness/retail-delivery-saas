require('./helpers/env');
// Rider reliability: put off duty by himself, one phone per rider, and the help button.
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const app = require('../src/server/app');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const { runRiderDuty } = require('../src/jobs/riderDuty');
const Tenant = require('../src/models/Tenant');
const Rider = require('../src/models/Rider');
const Session = require('../src/models/Session');
const Notification = require('../src/models/Notification');

let w; let n = 0;
const atIst = (h, m = 0) => new Date(Date.UTC(2026, 9, 20, h, m) - 330 * 60000);   // a Tuesday
const rider = (m, path, body) => request(app)[m](`/api/rider${path}`).set(w.rider.headers).send(body);
const riderDoc = () => Rider.findOne({ tenantId: w.tenant._id, userId: w.rider.user._id }).lean();
// on duty since 14:00 of the day the tests pretend it is (a Tuesday)
const onDuty = (extra = {}) => Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true, isOnline: true, activeOrderCount: 0, onlineSince: atIst(14, 0), ...extra } });

// the shop opens 9:00 to 22:00 every day (India time)
const WEEKLY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '09:00', close: '22:00' }]]));

before(async () => { await db.connect(); });
after(async () => { await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    w = await f.makeWorld(`rel-${++n}`);
    await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.hours.weekly': WEEKLY, phone: '9811111111' } });
    tenantRecognizer.invalidateTenant(w.tenant.slug);
});

describe('on duty and off duty', () => {
    test('the time he went on duty is kept, and cleared when he ends duty', async () => {
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { isActive: true } });
        await rider('put', '/online', { isOnline: true });
        assert.ok((await riderDoc()).onlineSince);
        await rider('put', '/online', { isOnline: false });
        assert.equal((await riderDoc()).onlineSince, undefined);
    });

    test('shop closed for half an hour: an idle rider is put off duty and told; the same night he can start again', async () => {
        await onDuty();
        assert.equal((await runRiderDuty(atIst(22, 10))).off, 0, 'closed only ten minutes ago');
        assert.equal((await riderDoc()).isOnline, true);
        assert.equal((await runRiderDuty(atIst(22, 40))).off, 1);
        const r = await riderDoc();
        assert.equal(r.isOnline, false);
        assert.equal(r.onlineSince, undefined);
        const note = await Notification.findOne({ tenantId: w.tenant._id, userId: w.rider.user._id, type: 'rider_off_duty' }).lean();
        assert.match(note.body, /shop is closed/);
        assert.equal((await rider('put', '/online', { isOnline: true })).status, 200);
    });

    test('a rider with an order, a shop that is open, or a shop the owner paused by hand: nobody is switched off', async () => {
        await onDuty({ activeOrderCount: 1 });
        assert.equal((await runRiderDuty(atIst(23, 30))).off, 0, 'he still has an order');
        await onDuty();
        assert.equal((await runRiderDuty(atIst(15, 0))).off, 0, 'the shop is open');
        await Tenant.updateOne({ _id: w.tenant._id }, { $set: { 'settings.orders.acceptingOrders': false } });
        assert.equal((await runRiderDuty(atIst(23, 30))).off, 0, 'paused by the owner: the rider waits');
        assert.equal((await riderDoc()).isOnline, true);
    });

    test('a very long duty ends by itself, even while the shop is open', async () => {
        await onDuty({ onlineSince: new Date(atIst(15, 0).getTime() - 17 * 3600000) });
        assert.equal((await runRiderDuty(atIst(15, 0))).off, 1);
        assert.match((await Notification.findOne({ type: 'rider_off_duty' })).body, /very long time/);
    });

    test('running again, or a rider switched off already, changes nothing', async () => {
        await onDuty();
        assert.equal((await runRiderDuty(atIst(23, 30))).off, 1);
        assert.equal((await runRiderDuty(atIst(23, 40))).off, 0);
        assert.equal(await Notification.countDocuments({ type: 'rider_off_duty' }), 1);
    });
});

describe('one phone per rider', () => {
    const login = async (phone) => {
        await f.plantOtp(w.tenant, phone, '654321');
        const r = await request(app).post('/api/auth/verify-otp').set('x-tenant-slug', w.tenant.slug).send({ phone, otp: '654321' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body;
    };

    test('a rider signing in on a second phone signs the first one out; an owner can use several phones', async () => {
        await login('9000000020');
        await login('9000000020');
        assert.equal(await Session.countDocuments({ userId: w.rider.user._id }), 1);
        const before = await Session.countDocuments({ userId: w.owner.user._id });
        await login('9000000010');
        await login('9000000010');
        assert.equal(await Session.countDocuments({ userId: w.owner.user._id }), before + 2);
    });
});

describe('the help button', () => {
    test('the owner is told at once with the rider\'s name and phone; a second tap within a minute adds nothing', async () => {
        await Rider.updateOne({ tenantId: w.tenant._id, userId: w.rider.user._id }, { $set: { name: 'Raju' } });
        const o = await f.makeOrder(w.tenant, w.customer.user, { status: 'out_for_delivery', delivery: { riderId: w.rider.user._id, status: 'picked_up' } });
        const a = await rider('post', '/sos', { orderId: String(o._id) });
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(a.body.repeated, false);
        assert.equal(a.body.shopPhone, '9811111111');
        await f.waitFor(async () => (await Notification.countDocuments({ tenantId: w.tenant._id, type: 'rider_sos' })) === 1);
        const note = await Notification.findOne({ type: 'rider_sos' }).lean();
        assert.match(note.body, /Raju pressed the help button \(order #\d+\)\. Call him now: 9000000020/);
        assert.equal(note.data.riderId, String(w.rider.user._id));
        const again = await rider('post', '/sos', {});
        assert.equal(again.body.repeated, true);
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(await Notification.countDocuments({ type: 'rider_sos' }), 1);
    });

    test('another rider\'s order number is never put in the message; a customer cannot use it', async () => {
        const theirs = await f.makeOrder(w.tenant, w.customer.user, { status: 'out_for_delivery', delivery: { riderId: w.owner.user._id, status: 'picked_up' } });
        await rider('post', '/sos', { orderId: String(theirs._id) });
        await f.waitFor(async () => (await Notification.countDocuments({ type: 'rider_sos' })) === 1);
        assert.doesNotMatch((await Notification.findOne({ type: 'rider_sos' })).body, /order #/);
        assert.equal((await request(app).post('/api/rider/sos').set(w.customer.headers).send({})).status, 403);
    });
});
