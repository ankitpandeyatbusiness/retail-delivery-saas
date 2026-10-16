// Push notification adapter (Firebase Cloud Messaging).
//
//   const r = await push.send({ tokens: ['...'], title: 'New order', body: '#1042', data: { orderId } });
//   r = { sent: 2, invalidTokens: ['...'] }   (invalid tokens should be deleted by the caller)
//
// PUSH_MOCK=true          -> prints in the console, sends nothing.
// FCM_SERVICE_ACCOUNT_B64 -> the Firebase service account JSON, converted to base64 (real push).
// With neither set, push is simply off (one warning in the console). It never breaks an order.

const mockProvider = {
    async send({ tokens, title, body }) {
        console.log(`[MOCK PUSH] to ${tokens?.length || 0} device(s): ${title} - ${body}`);
        return { sent: tokens?.length || 0, invalidTokens: [] };
    },
};

let messaging = null;
let warned = false;

function getMessaging() {
    if (messaging) return messaging;
    const b64 = process.env.FCM_SERVICE_ACCOUNT_B64;
    if (!b64) return null;
    // firebase-admin 12 and later: the modular API. The old namespaced one (admin.apps, admin.credential, app.messaging())
    // is gone in version 14, and using it made every push fail with "Push setup failed" and send nothing.
    const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');   // loaded only when push is really set up
    const { getMessaging: messagingOf } = require('firebase-admin/messaging');
    const cred = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const app = getApps().length ? getApp() : initializeApp({ credential: cert(cred) });
    messaging = messagingOf(app);
    return messaging;
}

// these two mean "this phone is gone, forget the token"
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

const realProvider = {
    // dataOnly: a silent message with no notification in it. It shows nothing and plays nothing; it only wakes the app's
    // own code for a few seconds (the owner's Soundbox uses it to read the order out with the screen off).
    async send({ tokens, title, body, data, channelId, sound, dataOnly }) {
        if (!tokens?.length) return { sent: 0, invalidTokens: [] };

        let m;
        try {
            m = getMessaging();
        } catch (e) {
            console.error('Push setup failed:', e.message);
            return { sent: 0, invalidTokens: [] };
        }
        if (!m) {
            if (!warned) { warned = true; console.warn('Push is off: FCM_SERVICE_ACCOUNT_B64 is not set'); }
            return { sent: 0, invalidTokens: [] };
        }

        const strData = {};   // FCM accepts only text values in data
        for (const [k, v] of Object.entries(data || {})) if (v !== undefined && v !== null) strData[k] = String(v);

        let sent = 0;
        const invalidTokens = [];
        for (let i = 0; i < tokens.length; i += 500) {
            const chunk = tokens.slice(i, i + 500);
            const r = await m.sendEachForMulticast(dataOnly
                ? { tokens: chunk, data: strData, android: { priority: 'high' } }
                : {
                    tokens: chunk,
                    notification: { title, body },
                    data: strData,
                    // channelId picks the phone's channel (its sound is fixed inside the app). Without one the app's default is used.
                    android: {
                        priority: 'high',
                        ...(channelId ? { notification: { channelId, ...(sound ? { sound } : {}) } } : {}),
                    },
                });
            r.responses.forEach((x, idx) => {
                if (x.success) sent += 1;
                else if (DEAD.has(x.error?.code)) invalidTokens.push(chunk[idx]);
                else console.warn('Push not delivered:', x.error?.code || 'unknown error');   // it used to vanish without a trace
            });
        }
        return { sent, invalidTokens };
    },
};

const provider = () => (process.env.PUSH_MOCK === 'true' ? mockProvider : realProvider);

module.exports = {
    send: (args) => provider().send(args),
    _messaging: getMessaging,   // for the test that checks the Firebase setup works with the installed library
};