// When does a conversation close by itself? The inquiry chat has ONE rule (the owner's "close quiet inquiries" setting is its only timer), and a support request
// the team answered is solved by itself after 7 days of silence.
require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const ServiceInquiry = require('../src/models/ServiceInquiry');
const SupportTicket = require('../src/models/SupportTicket');
const auto = require('../src/services/automations');
const support = require('../src/services/supportService');
const center = require('../src/notifications/center');

before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); });
afterEach(() => mock.restoreAll());

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const inquiry = (w, o = {}) => ServiceInquiry.create({ tenantId: w.tenant._id, serviceId: new mongoose.Types.ObjectId(), serviceName: 'Tiffin', userId: w.customer.user._id, name: 'Asha', phone: '9000000030', status: 'replied', lastMessageAt: ago(1), ...o });
const ownerChat = async (w, i) => (await request(app).get(`/api/shop/chat/inquiry/${i._id}`).set(w.owner.headers)).body;
const custChat = async (w, i) => (await request(app).get(`/api/chat/inquiry/${i._id}`).set(w.customer.headers)).body;
const setDays = (w, inquiryCloseDays) => auto.save(w.tenant._id, { inquiryCloseDays });
const cfg = (w) => async () => auto.get(w.tenant._id);

describe('the chat of an inquiry: the owner\'s setting is its only timer', () => {
    test('an inquiry nobody has answered never closes by itself, however old: the owner can always still reply', async () => {
        const w = await f.makeWorld('iq-new');
        const i = await inquiry(w, { status: 'new', lastMessageAt: ago(40) });
        const c = await ownerChat(w, i);
        assert.equal(c.closed, false);
        assert.equal(c.closesAt, null);
        assert.equal((await request(app).post(`/api/shop/chat/inquiry/${i._id}`).set(w.owner.headers).send({ text: 'Sorry for the wait' })).status, 201);
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 0);
    });

    test('7 days (the default): open until the 7th quiet day, then the rule ends it and the chat closes; the "closes in" time follows the setting', async () => {
        const w = await f.makeWorld('iq-7');
        const i = await inquiry(w, { lastMessageAt: ago(5) });
        const c = await ownerChat(w, i);
        assert.equal(c.closed, false);
        assert.ok(Math.abs(new Date(c.closesAt).getTime() - (new Date(i.lastMessageAt).getTime() + 7 * DAY)) < 5000, 'it closes 7 days after the last word');
        await ServiceInquiry.updateOne({ _id: i._id }, { $set: { lastMessageAt: ago(8) } });
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 1);
        assert.equal((await ownerChat(w, i)).closed, true);
        assert.equal((await custChat(w, i)).closed, true);
    });

    test('14 days: the chat is still open on day 10 (it used to close on day 7), and closes after day 14', async () => {
        const w = await f.makeWorld('iq-14');
        await setDays(w, 14);
        const i = await inquiry(w, { lastMessageAt: ago(10) });
        assert.equal((await ownerChat(w, i)).closed, false);
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 0, 'day 10: nothing yet');
        await ServiceInquiry.updateOne({ _id: i._id }, { $set: { lastMessageAt: ago(15) } });
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 1);
        assert.equal((await ownerChat(w, i)).closed, true);
    });

    test('3 days: it closes after day 3', async () => {
        const w = await f.makeWorld('iq-3');
        await setDays(w, 3);
        const i = await inquiry(w, { lastMessageAt: ago(4) });
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 1);
        assert.equal((await ownerChat(w, i)).closed, true);
    });

    test('Off: the chat stays open for ever, until the owner ends it himself', async () => {
        const w = await f.makeWorld('iq-off');
        await setDays(w, 0);
        const i = await inquiry(w, { lastMessageAt: ago(60) });
        const c = await ownerChat(w, i);
        assert.equal(c.closed, false);
        assert.equal(c.closesAt, null);
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 0);
        assert.equal((await request(app).patch(`/api/shop/inquiries/${i._id}`).set(w.owner.headers).send({ status: 'closed' })).status, 200);
        assert.equal((await ownerChat(w, i)).closed, true, 'ended by the owner: closed at once');
    });

    test('when the rule ends an inquiry, the customer is told in words, like when the owner ends it', async () => {
        const w = await f.makeWorld('iq-told');
        const sent = [];
        mock.method(center, 'notify', async (event, ctx) => { sent.push([event, ctx]); return {}; });
        const i = await inquiry(w, { lastMessageAt: ago(9) });
        assert.equal(await auto.closeQuietInquiries(Date.now(), cfg(w)), 1);
        const told = sent.find(([e]) => e === 'inquiry_ended');
        assert.ok(told, 'an "inquiry_ended" message was sent');
        assert.equal(String(told[1].userId), String(w.customer.user._id));
        assert.equal(told[1].vars.service, 'Tiffin');
        assert.equal(told[1].data.inquiryId, String(i._id));
    });

    test('nothing can be written to an ended conversation, also through the old reply routes', async () => {
        const w = await f.makeWorld('iq-ended');
        const i = await inquiry(w, { status: 'closed' });
        assert.equal((await request(app).post(`/api/shop/chat/inquiry/${i._id}`).set(w.owner.headers).send({ text: 'hi' })).status, 409);
        assert.equal((await request(app).post(`/api/shop/inquiries/${i._id}/reply`).set(w.owner.headers).send({ text: 'hi' })).status, 409);
        assert.equal((await request(app).post(`/api/services/inquiries/${i._id}/messages`).set(w.customer.headers).send({ text: 'hi' })).status, 400);
        assert.equal((await request(app).post(`/api/chat/inquiry/${i._id}`).set(w.customer.headers).send({ text: 'hi' })).status, 409);
    });
});

describe('a support request the team answered and the owner never replied to', () => {
    const ticket = (w, o = {}) => SupportTicket.create({
        number: Math.floor(Math.random() * 900000) + 1000, tenantId: w.tenant._id, userId: w.owner.user._id, category: 'other', subject: 'Printer help',
        status: 'answered', lastFrom: 'platform', lastMessageAt: ago(8), messages: [{ from: 'owner', text: 'It does not print' }, { from: 'platform', text: 'Please restart it', by: 'Support' }], ...o,
    });

    test('after 7 days of silence it is solved by itself, with a note; the owner is told; one that is newer, or that waits for the TEAM, is left alone', async () => {
        const w = await f.makeWorld('sup-auto');
        const sent = [];
        const notify = require('../src/services/notificationService');
        mock.method(notify, 'toOwner', (t, p) => sent.push(p));
        const quiet = await ticket(w);
        const recent = await ticket(w, { lastMessageAt: ago(3) });
        const waitsForTeam = await ticket(w, { status: 'open', lastFrom: 'owner', lastMessageAt: ago(30) });
        assert.equal(await support.autoResolveQuiet(), 1);
        const q = await SupportTicket.findById(quiet._id);
        assert.equal(q.status, 'resolved');
        assert.equal(q.resolvedBy, 'system');
        assert.ok(q.resolvedAt);
        assert.equal(q.messages.length, 3);
        assert.match(q.messages[2].text, /within 7 days/);
        assert.equal(q.messages[2].by, 'Support (automatic)');
        assert.equal(sent.length, 1);
        assert.equal((await SupportTicket.findById(recent._id)).status, 'answered');
        assert.equal((await SupportTicket.findById(waitsForTeam._id)).status, 'open');
        assert.equal(await support.autoResolveQuiet(), 0, 'running it again does nothing more');
    });

    test('the owner can write in it again within the next 7 days; it opens again', async () => {
        const w = await f.makeWorld('sup-reopen');
        const t = await ticket(w);
        await support.autoResolveQuiet();
        const r = await request(app).post(`/api/shop/support/${t._id}/reply`).set(w.owner.headers).send({ message: 'Still not printing, please help' });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.status, 'open');
        assert.equal((await SupportTicket.findById(t._id)).resolvedBy, undefined);
    });
});
