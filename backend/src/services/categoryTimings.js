// Menu timings: a category can be shown only at some hours (breakfast 07:00 to 11:00, and so on).
// Category.timings = [{ days?: ['mon', ...], open: 'HH:MM', close: 'HH:MM' }]. No timings = always shown.
// Days empty or missing = every day. A close time at or before the open time means "past midnight". India time.
const O = require('../config/tenantOptions');
const Category = require('../models/Category');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => { const [h, m] = t.split(':'); return Number(h) * 60 + Number(m); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// returns null when fine, or a message for the owner
function timingsError(list) {
    if (!Array.isArray(list)) return 'timings must be a list';
    if (list.length > 6) return 'Use up to 6 time slots';
    for (const t of list) {
        if (!isObj(t)) return 'Each time slot needs open and close';
        if (!TIME.test(t.open) || !TIME.test(t.close)) return 'Open and close must look like 07:30';
        if (t.open === t.close) return 'Open and close cannot be the same time';
        if (t.days !== undefined) {
            if (!Array.isArray(t.days) || t.days.length > 7 || new Set(t.days).size !== t.days.length
                || t.days.some((d) => !O.DAYS.includes(d))) return `days must be a list of: ${O.DAYS.join(', ')}`;
        }
    }
    return null;
}

function isOpenNow(timings, now = new Date()) {
    if (!Array.isArray(timings) || !timings.length) return true;
    const ist = new Date(now.getTime() + 330 * 60000);
    const day = ist.getUTCDay();
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const covers = (slot, d) => !slot.days || !slot.days.length || slot.days.includes(O.DAYS[d]);
    return timings.some((s) => {
        if (!s || !TIME.test(s.open) || !TIME.test(s.close)) return false;
        const o = toMin(s.open);
        const c = toMin(s.close);
        if (c > o) return covers(s, day) && mins >= o && mins < c;
        return (covers(s, day) && mins >= o) || (covers(s, (day + 6) % 7) && mins < c);   // past midnight
    });
}

// ids of the active categories that are shown right now
async function openCategoryIds(tenantId, now = new Date()) {
    const cats = await Category.find({ tenantId, isActive: true }).select('_id timings').lean();
    return cats.filter((c) => isOpenNow(c.timings, now)).map((c) => c._id);
}

module.exports = { timingsError, isOpenNow, openCategoryIds };