// An owner opens an old, closed inquiry again: the "quiet inquiries are ended automatically" rule must not close it again at once.
require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const ServiceInquiry = require('../src/models/ServiceInquiry');
const auto = require('../src/services/automations');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); });

const DAY = 86400000;
const cfg = async () => ({ inquiryCloseDays: 3 });
const old = (w, o = {}) => ServiceInquiry.create({ tenantId: w.tenant._id, serviceId: new mongoose.Types.ObjectId(), serviceName: 'Tiffin', userId: w.customer.user._id, name: 'Asha', phone: '9000000030', status: 'closed', lastMessageAt: new Date(Date.now() - 20 * DAY), ...o });

describe('opening a closed inquiry again', () => {
    test('its quiet time starts over, so the automation does not end it again', async () => {
        const w = await f.makeWorld('inq-reopen');
        const inq = await old(w);
        const r = await request(app).patch(`/api/shop/inquiries/${inq._id}`).set(w.owner.headers).send({ status: 'replied' });
        assert.equal(r.status, 200);
        assert.equal(r.body.status, 'replied');
        const fresh = await ServiceInquiry.findById(inq._id);
        assert.ok(Date.now() - new Date(fresh.lastMessageAt).getTime() < 60000, 'the last-message time is now');
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg), 0, 'nothing is ended');
        assert.equal((await ServiceInquiry.findById(inq._id)).status, 'replied', 'it stays open');
    });

    test('a status change that is not a reopen does not touch the time; a really quiet inquiry is still ended', async () => {
        const w = await f.makeWorld('inq-quiet');
        const longAgo = new Date(Date.now() - 20 * DAY);
        const a = await old(w, { status: 'replied', lastMessageAt: longAgo });
        const r = await request(app).patch(`/api/shop/inquiries/${a._id}`).set(w.owner.headers).send({ status: 'quoted' });
        assert.equal(r.status, 200);
        assert.equal(new Date((await ServiceInquiry.findById(a._id)).lastMessageAt).getTime(), longAgo.getTime());
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg), 1);
        assert.equal((await ServiceInquiry.findById(a._id)).status, 'closed');
    });
});
