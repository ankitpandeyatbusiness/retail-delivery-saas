// Puts the demo shop back to the start: its content is rebuilt (services/demoSeed.js), every file a visitor uploaded is deleted, and the
// rider pins are forgotten. The demo people and their logins stay, so people who are inside the demo are not signed out.
// reset() runs when someone taps Reset (at most once a minute) and by itself every night. Real shops are never touched.
const Tenant = require('../models/Tenant');
const Media = require('../models/Media');
const Session = require('../models/Session');
const demoTenant = require('./demoTenant');

const MIN_GAP_MS = 60 * 1000;
const NIGHT_HOUR_IST = 4;
let last = 0;
let running = null;
let timer = null;

async function dropUploads(tenantIds) {
    const storage = require('./adapters/storage');
    const rows = await Media.find({ tenantId: { $in: tenantIds } }).select('key').lean();
    for (const m of rows) { try { await storage.remove(m.key); } catch (e) { /* the file may already be gone */ } }
    await Media.deleteMany({ tenantId: { $in: tenantIds } });
    return rows.length;
}

async function reset({ force = false } = {}) {
    if (running) return running;   // two taps at once make one reset
    const wait = last + MIN_GAP_MS - Date.now();
    if (!force && wait > 0) { const e = new Error(`The demo was just reset. Try again in ${Math.ceil(wait / 1000)} seconds.`); e.status = 429; throw e; }
    running = (async () => {
        try {
            const seeded = await require('./demoSeed').seed();
            const shops = await Tenant.find({ isDemo: true }).select('_id').lean();
            const files = await dropUploads(shops.map((s) => s._id));
            try { require('./liveTracking').reset(); } catch (e) { /* only memory */ }
            last = Date.now();
            return { ok: true, ...seeded, files };
        } finally { running = null; }
    })();
    return running;
}

// a demo shop that has no menu yet gets one the first time it is needed
async function ensureReady() {
    const t = await demoTenant.ensureTenant();
    if (!(await require('../models/Product').exists({ tenantId: t._id }))) await require('./demoSeed').seed();
    return t;
}

const istHour = (d = new Date()) => new Date(+d + 330 * 60000).getUTCHours();
function startNightly() {
    if (timer || process.env.DEMO_ENGINE === 'off') return;
    let doneDay = '';
    timer = setInterval(() => {
        const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
        if (istHour() === NIGHT_HOUR_IST && doneDay !== day) {
            doneDay = day;
            Tenant.exists({ isDemo: true }).then((has) => has && reset({ force: true })).catch((e) => console.error('Demo reset error:', e.message));
        }
    }, 10 * 60 * 1000);
    if (timer.unref) timer.unref();
}

module.exports = { reset, ensureReady, startNightly, dropUploads };
