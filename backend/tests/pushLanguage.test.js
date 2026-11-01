require('./helpers/env');
const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const User = require('../src/models/User');
const DeviceToken = require('../src/models/DeviceToken');
const pushChannel = require('../src/notifications/channels/push');
const pushAdapter = require('../src/services/adapters/push');
const i18n = require('../src/notifications/i18n');
const texts = require('../src/notifications/templates/texts');

// A push is written in each person's own language (User.language), with the values (order number, dish, amount) kept.
let world;
let calls;
const realSend = pushAdapter.send;

before(async () => { await db.connect(); });
after(async () => { pushAdapter.send = realSend; await db.disconnect(); });
beforeEach(async () => {
    await db.clear();
    world = await f.makeWorld('lang-shop');
    calls = [];
    pushAdapter.send = async (a) => { calls.push(a); return { sent: a.tokens.length, invalidTokens: [] }; };
});

describe('push in the person\'s language', () => {
    test('a text is translated exactly or by its pattern, values kept; English and unknown texts stay as they are', () => {
        const t = texts.build('order_status', { status: 'accepted', orderNo: 1042, brief: '2× Butter Naan', total: 540 });
        assert.equal(i18n.translate(t.title, 'hi'), 'ऑर्डर #1042 स्वीकार हुआ');
        assert.match(i18n.translate(t.body, 'gu'), /^2× Butter Naan · ₹540\. /);
        assert.equal(i18n.translate(t.title, 'bho'), 'ऑर्डर #1042 स्वीकार भइल', 'Bhojpuri has its own words');
        assert.equal(i18n.translate('Order is taking long', 'bho'), 'ऑर्डर में देर होत बा');
        assert.equal(i18n.translate(t.title, 'en'), t.title);
        assert.equal(i18n.translate('Something new nobody translated', 'hi'), 'Something new nobody translated');
        assert.equal(i18n.translate('Minimum order is ₹200', 'mr'), 'किमान ऑर्डर ₹200 आहे', 'server messages too');
    });

    test('each phone gets its own person\'s language; a person with no language gets English', async () => {
        const hiUser = await f.makeUser(world.tenant, 'customer', '9000000101');
        const enUser = await f.makeUser(world.tenant, 'customer', '9000000102');
        await User.updateOne({ _id: hiUser.user._id }, { $set: { language: 'hi' } });
        await DeviceToken.create({ tenantId: world.tenant._id, userId: hiUser.user._id, token: 'H'.repeat(30) });
        await DeviceToken.create({ tenantId: world.tenant._id, userId: enUser.user._id, token: 'E'.repeat(30) });
        const t = texts.build('refund_processed', { amount: 120, orderNo: 55 });

        await pushChannel.send({ tenantId: world.tenant._id, userId: hiUser.user._id, ...t });
        await pushChannel.send({ tenantId: world.tenant._id, userId: enUser.user._id, ...t });
        assert.equal(calls.length, 2);
        assert.equal(calls[0].title, 'रिफ़ंड भेज दिया गया');
        assert.match(calls[0].body, /ऑर्डर #55 के ₹120/);
        assert.equal(calls[1].title, 'Refund processed');
        assert.equal(calls[1].body, t.body);
    });

    test('owners with different languages get one push each, in their own words', async () => {
        const second = await f.makeUser(world.tenant, 'admin', '9000000103');
        await User.updateOne({ _id: second.user._id }, { $set: { language: 'gu' } });
        await DeviceToken.create({ tenantId: world.tenant._id, userId: world.owner.user._id, token: 'A'.repeat(30) });
        await DeviceToken.create({ tenantId: world.tenant._id, userId: second.user._id, token: 'G'.repeat(30) });
        await pushChannel.send({ tenantId: world.tenant._id, ...texts.build('rider_none', { orderNo: 9 }) });
        const byToken = Object.fromEntries(calls.map((c) => [c.tokens[0], c]));
        assert.equal(byToken['A'.repeat(30)].title, 'No rider available');
        assert.equal(byToken['G'.repeat(30)].title, 'કોઈ રાઇડર ઉપલબ્ધ નથી');
        assert.match(byToken['G'.repeat(30)].body, /ઓર્ડર #9/);
    });
});
