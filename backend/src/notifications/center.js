// The ONLY function the rest of the code calls to tell someone something:  center.notify(eventKey, ctx)
//
//   ctx = { tenantId, userId?, title?, body?, data?, vars? }
//         userId = a customer or rider. No userId = the owner side of the shop.
//         title/body = your own words. Left out = the wording from templates/texts.js.
//
// What every message does (nobody has to be on the app, or off it, to get it):
//   1. The inbox row is ALWAYS saved (the in-app notification).
//   2. He is on the app right now  -> the live message too (toast and badge).
//   3. A push to his phones, ALWAYS, whether he is on the app or not. (`channels` and `alsoPush` in events.js no longer hold a push back.)
//   4. Only when neither the live message nor the push reached anyone, and only for key events and only if allowed -> SMS from the shop wallet.
//   5. Events with escalateSmsAfterSec also get an SMS later if he never reads the message (jobs/notificationEscalation).
//   6. Events with email get a mail in the queue.
//   7. Events with adminAlert also alert the superadmin (before the owner's own rule is checked).
// It never throws: a notification problem can never break an order.
const Notification = require('../models/Notification');
const rules = require('./rules');
const presence = require('./presence');
const texts = require('./templates/texts');
const inapp = require('./channels/inapp');
const pushChannel = require('./channels/push');
const smsChannel = require('./channels/sms');
const emailChannel = require('./channels/email');
const adminAlerts = require('../services/adminAlerts');
const alertGroups = require('./alertGroups');
const textsHi = require('./templates/textsHi');
const liveFeed = require('../services/liveFeed');

// Owner-side events that also show in the superadmin live feed: eventKey -> [category, line type].
// Order and rider lines are made in notificationService, so they are not repeated here.
const FEED = {
    bill_issued: ['billing', 'bill.issued'],
    bill_reminder: ['billing', 'bill.reminder'],
    payment_received: ['billing', 'payment.received'],
    free_ending: ['billing', 'free.ending'],
    shop_paused: ['billing', 'shop.paused'],
    shop_unpaused: ['billing', 'shop.unpaused'],
    sms_topup_done: ['sms', 'sms.topup'],
    sms_low: ['sms', 'sms.low'],
    sms_zero: ['sms', 'sms.zero'],
    platform_message: ['messages', 'message.platform'],
    complaint_new: ['complaints', 'complaint.new'],
    complaint_reminder: ['complaints', 'complaint.reminder'],
    dish_low_rating: ['complaints', 'rating.low'],
    broadcast: ['messages', 'message.broadcast'],   // only the owner side (a superadmin broadcast) reaches this line
};

const isKey = (def, ctx) => (typeof def.key === 'function' ? !!def.key(ctx) : !!def.key);
// riders never get an SMS, whatever the rules say
const wantsSms = (def, ctx) => (def.channels || []).includes('sms') && def.to !== 'rider' && isKey(def, ctx);

// these already carry their own sentence and have their own way of being read out (utils/orderSpeech.js)
const ALREADY_SPOKEN = ['order_new', 'order_unaccepted_reminder', 'order_cancelled', 'rider_sos', 'kitchen_problem', 'pickup_intent'];

async function deliver(eventKey, def, ctx, doc) {
    const { tenantId, userId } = ctx;
    const online = userId ? presence.isOnline(tenantId, userId) : presence.ownerOnline(tenantId);
    let delivered = false;

    if (online) {
        try {
            inapp.live({ tenantId, userId, doc });
            delivered = true;
        } catch (e) {
            console.error('Live message error:', e.message);
        }
    }

    // News for the owner (a leave, a day off, a review, a rent bill...) is read out too, with its details, when his phone is closed or the screen is off:
    // the push carries the words, and a second silent message wakes the app to say them (notifications/channels/push.js)
    const news = ctx.userId ? def.voice === true : (!!alertGroups.groupOf('admin', eventKey) && !ALREADY_SPOKEN.includes(eventKey));
    const pushData = { ...(ctx.data || {}), type: doc.type, ...(news && def.noPush !== true ? { voice: '1', speech: ctx.data?.speech || `${doc.title}. ${doc.body}` } : {}) };

    if (def.noPush !== true) {   // a QUIET message (noPush in events.js) is only in the list: no phone alert at all
        try {
            const r = await pushChannel.send({
                tenantId, userId, title: doc.title, body: doc.body, data: pushData,
                channelId: def.pushChannel, sound: def.pushSound,   // e.g. the owner's loud new-order channel
                tag: ctx.tag,                                        // the same tag replaces the earlier push (live delivery)
            });
            if (r && r.sent > 0) delivered = true;
        } catch (e) {
            console.error('Push error:', e.message);
        }
    }

    if (!delivered && wantsSms(def, ctx)) {
        try {
            const r = await smsChannel.send({ eventKey, def, ctx });
            if (r && r.sent) await Notification.updateOne({ _id: doc._id }, { $set: { smsSentAt: new Date() } });
        } catch (e) {
            console.error('SMS error:', e.message);
        }
    }
}

async function notify(eventKey, ctx = {}) {
    try {
        const { tenantId } = ctx;
        const toAdmin = ctx.to === 'superadmin';
        if (!tenantId && !toAdmin) return null;

        const def = await rules.get(eventKey, tenantId);

        // the live feed hears about it even when the owner switched his own message off
        if (FEED[eventKey] && tenantId && !ctx.userId && !toAdmin) {
            liveFeed.emit(tenantId, FEED[eventKey][0], { type: FEED[eventKey][1], ...(ctx.data || {}) });
        }

        // the platform owner also hears about the big owner-side events, whatever the owner's own rule says
        if (def.adminAlert && tenantId && !ctx.userId && !toAdmin) {
            await adminAlerts.alert(def.adminAlert, { tenantId, vars: ctx.vars, data: ctx.data });
        }
        if (def.enabled === false) return null;   // switched off by a rule

        const vars = ctx.vars || {};
        const text = ctx.title ? { title: ctx.title, body: ctx.body } : texts.build(eventKey, vars);
        if (!text) return null;

        // the Hindi sentence for the Soundbox, made from the same values (an alert with none is read in English)
        const hi = textsHi.build(eventKey, vars);
        const data = hi && !ctx.data?.speechHi ? { ...(ctx.data || {}), speechHi: hi } : ctx.data;

        const escalate = def.escalateSmsAfterSec > 0 && wantsSms(def, ctx);
        const doc = await inapp.save({
            tenantId,
            userId: ctx.userId,
            role: ctx.userId ? undefined : (toAdmin ? 'superadmin' : 'owner'),
            type: ctx.type || eventKey,
            title: text.title,
            body: text.body,
            data,
            escalateAt: escalate ? new Date(Date.now() + def.escalateSmsAfterSec * 1000) : undefined,
        });
        if (toAdmin) return doc;   // platform inbox only (admin alerts go through services/adminAlerts.js)

        await deliver(eventKey, def, { ...ctx, data, vars }, doc);
        if (def.email && !ctx.noEmail) await emailChannel.queue({ eventKey, def, ctx: { ...ctx, vars } });   // a mail, whatever happened above
        return doc;
    } catch (e) {
        console.error(`Notification (${eventKey}) error:`, e.message);
        return null;
    }
}

// Called by the escalation job for a message that stayed unread. The job already claimed it.
async function escalate(n) {
    const def = await rules.get(n.type, n.tenantId);
    const ctx = { tenantId: n.tenantId, userId: n.userId, data: n.data, vars: {} };
    if (def.enabled === false || !wantsSms(def, ctx)) return { sent: false };
    return smsChannel.send({ eventKey: n.type, def, ctx });
}

module.exports = { notify, escalate };