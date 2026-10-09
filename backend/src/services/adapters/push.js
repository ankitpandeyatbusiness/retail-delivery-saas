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
    const admin = require('firebase-admin');   // loaded only when push is really set up
    const cred = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(cred) });
    messaging = app.messaging();
    return messaging;
}

// these two mean "this phone is gone, forget the token"
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

const realProvider = {
    async send({ tokens, title, body, data }) {
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
            const r = await m.sendEachForMulticast({
                tokens: chunk,
                notification: { title, body },
                data: strData,
                android: { priority: 'high' },
            });
            r.responses.forEach((x, idx) => {
                if (x.success) sent += 1;
                else if (DEAD.has(x.error?.code)) invalidTokens.push(chunk[idx]);
            });
        }
        return { sent, invalidTokens };
    },
};

const provider = () => (process.env.PUSH_MOCK === 'true' ? mockProvider : realProvider);

module.exports = { send: (args) => provider().send(args) };