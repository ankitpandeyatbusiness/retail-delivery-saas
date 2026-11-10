// Push to BROWSERS (the website): the standard Web Push protocol with VAPID keys. Separate from adapters/push.js, which sends to phones through Firebase.
//
//   const r = await webPush.send({ subscriptions: [{ endpoint, keys: { p256dh, auth } }], title, body, data, tag, icon, silent });
//   r = { sent: 1, invalidEndpoints: ['https://...'] }   (those browsers are gone: the caller deletes them)
//
// Needs three env values, otherwise browser push is simply off (and the website hides its switch):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   made once with:  node backend/src/scripts/generateVapidKeys.js
//   VAPID_SUBJECT                          who runs the service, "mailto:you@yourcompany.in" or "https://yourcompany.in" (push services ask for it)
// PUSH_MOCK=true -> prints in the console, sends nothing.

let ready = false;

function configured() {
    return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

const publicKey = () => (configured() ? process.env.VAPID_PUBLIC_KEY : null);

// the real library, set up once. (A test replaces impl.load with a stand-in.)
const impl = {
    load() {
        const webpush = require('web-push');
        if (!ready) {
            webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
            ready = true;
        }
        return webpush;
    },
};

// a push message can carry about 4 KB: keep the small facts the website needs to open the right screen
function smallData(data) {
    if (!data) return undefined;
    try { if (JSON.stringify(data).length <= 1800) return data; } catch (e) { /* fall through */ }
    const { type, orderId, bulkId, bookingId, inquiryId } = data;
    return { type, orderId, bulkId, bookingId, inquiryId };
}

async function send({ subscriptions, title, body, data, tag, icon, silent }) {
    const list = (subscriptions || []).filter((s) => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
    if (!list.length) return { sent: 0, invalidEndpoints: [] };
    if (process.env.PUSH_MOCK === 'true') {
        console.log(`[MOCK WEB PUSH] to ${list.length} browser(s): ${title} - ${body}`);
        return { sent: list.length, invalidEndpoints: [] };
    }
    if (!configured()) return { sent: 0, invalidEndpoints: [] };
    const payload = JSON.stringify({ title, body, data: smallData(data), tag: tag || undefined, icon: icon || undefined, silent: !!silent });
    const webpush = impl.load();
    let sent = 0;
    const invalidEndpoints = [];
    await Promise.all(list.map(async (s) => {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600, urgency: 'high' });
            sent += 1;
        } catch (e) {
            if (e && (e.statusCode === 404 || e.statusCode === 410)) invalidEndpoints.push(s.endpoint);   // the browser unsubscribed or was uninstalled
            else console.warn('[web push] failed:', e && (e.statusCode || e.message));
        }
    }));
    return { sent, invalidEndpoints };
}

module.exports = { send, configured, publicKey, impl };
