// The red-light watcher. Every 10 minutes it reads the platform health and tells the superadmins when a card TURNS red (a push and an inbox
// message), once. If the card stays red it says so again after 6 hours; when it goes back to normal the memory is cleared, so the next time
// is "new" again. Cards that already have their own alert are left out so nobody is told twice (payment notices, an SMS provider that is failing).
// The right to alert is claimed with one atomic update per card, so two servers never send it twice. It never throws.
const PlatformSettings = require('../models/PlatformSettings');
const health = require('./platformHealth');
const adminAlerts = require('./adminAlerts');

const REPEAT_MS = 6 * 3600000;
const TITLE = { system: 'Server or backup', sms: 'SMS', rent: 'Rent', orders: 'Orders', google: 'Google calls', shops: 'Shops', support: 'Support', quiet: 'Quiet shops', versions: 'App versions' };

async function check(now = new Date(), { summary } = {}) {
    let sent = 0;
    try {
        const h = summary || await health.build(now);
        // the ones that alert by themselves: payment notices, and SMS while the provider is failing
        const red = Object.entries(h).filter(([key, c]) => c && c.level === 'bad' && key !== 'payments' && !(key === 'sms' && c.failing));
        const settings = await PlatformSettings.findById('main').select('alerts.healthState').lean();
        const state = settings?.alerts?.healthState || {};
        const redKeys = new Set(red.map(([k]) => k));

        for (const [key, card] of red) {
            const cur = state[key];
            let claimed = false;
            if (!cur) {
                const r = await PlatformSettings.updateOne({ _id: 'main', [`alerts.healthState.${key}`]: { $exists: false } }, { $set: { [`alerts.healthState.${key}`]: { since: now, lastAt: now } } }, { upsert: true }).catch((e) => (e.code === 11000 ? { modifiedCount: 0, upsertedCount: 0 } : Promise.reject(e)));
                claimed = !!(r.modifiedCount || r.upsertedCount);
            } else if (now.getTime() - new Date(cur.lastAt).getTime() >= REPEAT_MS) {
                const r = await PlatformSettings.updateOne({ _id: 'main', [`alerts.healthState.${key}.lastAt`]: { $lte: new Date(now.getTime() - REPEAT_MS) } }, { $set: { [`alerts.healthState.${key}.lastAt`]: now } });
                claimed = !!r.modifiedCount;
            }
            if (!claimed) continue;
            await adminAlerts.alert('admin_platform_red', { vars: { title: TITLE[key] || key, detail: card.note, again: !!cur }, data: { kind: 'health', card: key } });
            sent += 1;
        }
        // back to normal: forget it, so the next red is a new alert
        const gone = Object.keys(state).filter((k) => !redKeys.has(k));
        if (gone.length) await PlatformSettings.updateOne({ _id: 'main' }, { $unset: Object.fromEntries(gone.map((k) => [`alerts.healthState.${k}`, ''])) });
    } catch (e) {
        console.error('Health watch error:', e.message);
    }
    return sent;
}

function startHealthWatchScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { const n = await check(); if (n) console.log(`Platform health: ${n} red alert(s) sent`); } finally { running = false; }
    };
    setTimeout(run, 2 * 60 * 1000).unref?.();
    setInterval(run, 10 * 60 * 1000).unref?.();
}

module.exports = { check, startHealthWatchScheduler, REPEAT_MS };
