// ONE GST for every shop, set only by the superadmin. A shop's bills use it only while the shop has a GST
// number saved (and only the superadmin can save or change that number).
// resolveConfig() is synchronous, so the value is kept in memory and refreshed every minute and on every save.
const PlatformSettings = require('../models/PlatformSettings');

let current = { mode: 'none', percent: 0 };

async function load() {
    const doc = await PlatformSettings.collection.findOne({ _id: 'main' }, { projection: { tax: 1 } });
    const t = doc?.tax || {};
    const percent = Number.isFinite(t.gstPercent) ? t.gstPercent : 0;
    const mode = ['inclusive', 'exclusive'].includes(t.gstMode) ? t.gstMode : 'inclusive';
    current = percent > 0 ? { mode, percent } : { mode: 'none', percent: 0 };
    return current;
}

let timer = null;
function start() {
    load().catch((e) => console.error('Platform tax load failed:', e.message));
    if (!timer) {
        timer = setInterval(() => load().catch(() => { }), 60 * 1000);
        timer.unref?.();
    }
}

// what every shop with a GST number charges: { mode: 'none' | 'inclusive' | 'exclusive', percent }
const get = () => ({ ...current });

module.exports = { load, start, get };
