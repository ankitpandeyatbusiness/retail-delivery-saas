// A push to the people who read a legal document, when the supreme admin sends a new version of it.
// customer_terms / privacy / about_us are read by everybody who uses the apps; the owner documents only by shop owners.
// Each phone gets the text in its person's language (User.language). Nothing here may stop "Send new version": errors are logged only.
const User = require('../models/User');
const DeviceToken = require('../models/DeviceToken');
const adapter = require('./adapters/push');
const i18n = require('../notifications/i18n');

const EVERYONE = ['customer', 'rider', 'kitchen', 'waiter', 'admin'];
const WHO = { customer_terms: EVERYONE, privacy: EVERYONE, about_us: EVERYONE, owner_terms: ['admin'], owner_privacy: ['admin'], rider_terms: ['rider'], rider_privacy: ['rider'], staff_terms: ['kitchen', 'waiter'], staff_privacy: ['kitchen', 'waiter'] };

const TEXT = {
    customer_terms: { title: 'Terms of Service updated', body: 'We have updated our Terms of Service. You can read them in About Us.' },
    privacy: { title: 'Privacy Policy updated', body: 'We have updated our Privacy Policy. You can read it in About Us.' },
    about_us: { title: 'About Us updated', body: 'Our About Us page has new information. Take a look.' },
    owner_terms: { title: 'Terms of Service for shop owners updated', body: 'Please open About Us to read the new terms and agree to them.' },
    owner_privacy: { title: 'Privacy Policy for shop owners updated', body: 'Please open About Us to read the new policy and agree to it.' },
    rider_terms: { title: 'Terms of Service for riders updated', body: 'We have updated the terms for riders. You can read them in About Us.' },
    rider_privacy: { title: 'Privacy Policy for riders updated', body: 'We have updated the privacy policy for riders. You can read it in About Us.' },
    staff_terms: { title: 'Terms of Service for kitchen staff and waiters updated', body: 'We have updated your terms. You can read them in About Us.' },
    staff_privacy: { title: 'Privacy Policy for kitchen staff and waiters updated', body: 'We have updated your privacy policy. You can read it in About Us.' },
};

const BATCH = 500;

async function notifyNewVersion(key) {
    const roles = WHO[key];
    const text = TEXT[key];
    if (!roles || !text) return { sent: 0 };
    let sent = 0;
    const cursor = User.find({ role: { $in: roles }, isBlocked: { $ne: true } }).select('_id language').lean().cursor();
    let batch = [];
    const flush = async () => {
        if (!batch.length) return;
        const langOf = new Map(batch.map((u) => [String(u._id), u.language || 'en']));
        const rows = await DeviceToken.find({ userId: { $in: batch.map((u) => u._id) } }).select('token userId').lean();
        const byLang = new Map();
        for (const r of rows) {
            const l = langOf.get(String(r.userId)) || 'en';
            if (!byLang.has(l)) byLang.set(l, []);
            byLang.get(l).push(r.token);
        }
        const invalid = [];
        for (const [lang, tokens] of byLang) {
            const res = await adapter.send({ tokens, title: i18n.translate(text.title, lang), body: i18n.translate(text.body, lang), data: { type: 'legal', docKey: key } });
            sent += res?.sent || 0;
            if (res?.invalidTokens?.length) invalid.push(...res.invalidTokens);
        }
        if (invalid.length) await DeviceToken.deleteMany({ token: { $in: invalid } });
        batch = [];
    };
    for await (const u of cursor) {
        batch.push(u);
        if (batch.length >= BATCH) await flush();
    }
    await flush();
    return { sent };
}

// fire and forget: the admin's "Send new version" never waits for, or fails because of, the push
function afterSend(key) {
    notifyNewVersion(key).catch((e) => console.error('Legal push error:', e.message));
}

module.exports = { notifyNewVersion, afterSend, WHO, TEXT };
