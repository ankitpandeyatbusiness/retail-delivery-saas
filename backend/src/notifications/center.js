// The ONLY function the rest of the code calls to tell someone something:  center.notify(eventKey, ctx)
//
//   ctx = { tenantId, userId?, title?, body?, data?, vars? }
//         userId = a customer or rider. No userId = the owner side of the shop.
//         title/body = your own words. Left out = the wording from templates/texts.js.
//
// The waterfall (the first step that reaches him ends it):
//   1. The inbox row is ALWAYS saved.
//   2. He is online and the event has "inapp"  -> live message. Done.
//   3. Else, a push to his phones (events with alsoPush send the push even when he is online).
//   4. Else, only for key events and only if allowed -> SMS from the shop wallet.
//   5. Events with escalateSmsAfterSec also get an SMS later if he never reads the message (jobs/notificationEscalation).
// It never throws: a notification problem can never break an order.
const Notification = require('../models/Notification');
const rules = require('./rules');
const presence = require('./presence');
const texts = require('./templates/texts');
const inapp = require('./channels/inapp');
const pushChannel = require('./channels/push');
const smsChannel = require('./channels/sms');
const emailChannel = require('./channels/email');

const isKey = (def, ctx) => (typeof def.key === 'function' ? !!def.key(ctx) : !!def.key);
// riders never get an SMS, whatever the rules say
const wantsSms = (def, ctx) => (def.channels || []).includes('sms') && def.to !== 'rider' && isKey(def, ctx);

async function deliver(eventKey, def, ctx, doc) {
    const { tenantId, userId } = ctx;
    const channels = def.channels || [];
    const online = userId ? presence.isOnline(tenantId, userId) : presence.ownerOnline(tenantId);
    let delivered = false;

    if (online && channels.includes('inapp')) {
        try {
            inapp.live({ tenantId, userId, doc });
            delivered = true;
        } catch (e) {
            console.error('Live message error:', e.message);
        }
    }

    if (channels.includes('push') && (!delivered || def.alsoPush)) {
        try {
            const r = await pushChannel.send({
                tenantId, userId, title: doc.title, body: doc.body, data: { ...(ctx.data || {}), type: doc.type },
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
        if (def.enabled === false) return null;   // switched off by a rule

        const vars = ctx.vars || {};
        const text = ctx.title ? { title: ctx.title, body: ctx.body } : texts.build(eventKey, vars);
        if (!text) return null;

        const escalate = def.escalateSmsAfterSec > 0 && wantsSms(def, ctx);
        const doc = await inapp.save({
            tenantId,
            userId: ctx.userId,
            role: ctx.userId ? undefined : (toAdmin ? 'superadmin' : 'owner'),
            type: ctx.type || eventKey,
            title: text.title,
            body: text.body,
            data: ctx.data,
            escalateAt: escalate ? new Date(Date.now() + def.escalateSmsAfterSec * 1000) : undefined,
        });
        if (toAdmin) return doc;   // platform inbox only for now (the admin alerts come in the next part)

        await deliver(eventKey, def, { ...ctx, vars }, doc);
        if (def.email) await emailChannel.queue({ eventKey, def, ctx: { ...ctx, vars } });   // a mail, whatever happened above
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