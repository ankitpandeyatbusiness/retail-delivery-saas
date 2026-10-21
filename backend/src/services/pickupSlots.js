// Pickup time windows for the cart screen.
const { resolveConfig, openStatus, DEFAULTS } = require('./tenantConfigService');

const IST_MS = 330 * 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const STEP_MS = 5 * 60000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const istFmt = (ms) => {
    const d = new Date(ms + IST_MS);
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
};
const istDayStart = (ms) => Math.floor((ms + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
const istDate = (ms) => {
    const d = new Date(ms + IST_MS);
    return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

// 2-hour windows that always start at an odd hour (1 PM, 3 PM, 5 PM ... IST), for today and tomorrow. Only windows that have not begun yet are offered.
// Parts of a window when the shop is closed are cut off, so a window never runs past the closing time (and starts no earlier than the opening time).
function pickupSlots(tenant, now = new Date()) {
    const config = resolveConfig(tenant, now);
    if (!config.restaurant.isOpen) {
        return {
            open: false, slots: [],
            message: config.restaurant.closedReason === 'paused' ? 'The shop is not accepting orders right now' : config.hours.closedMessage,
        };
    }
    const maxPerDay = ({ ...DEFAULTS.orders.limits, ...(config.orders.limits || {}) }).pickupSlotsPerDay;   // set by the super admin
    const nowMs = now.getTime();
    const readyMs = nowMs + (config.orders.prepTimeMin || 0) * 60000;
    const weekly = config.hours.weekly;
    const isOpenAt = (ms) => openStatus(weekly, true, new Date(ms)).isOpen;
    const today0 = istDayStart(nowMs);

    let s = Math.floor((nowMs + IST_MS) / HOUR_MS) * HOUR_MS - IST_MS;      // start of this hour
    if (new Date(s + IST_MS).getUTCHours() % 2 === 0) s -= HOUR_MS;          // go back to the odd hour
    const slots = [];
    const perDay = [0, 0];
    for (; s < today0 + 2 * DAY_MS; s += 2 * HOUR_MS) {
        if (s < nowMs) continue;   // a window that has already begun is not offered: at 8 PM the 7-9 PM window is gone, the next one is 9 PM
        const cap = s + 2 * HOUR_MS;
        let from = Math.ceil(Math.max(s, nowMs) / STEP_MS) * STEP_MS;
        while (from < cap && !isOpenAt(from)) from += STEP_MS;
        if (from >= cap) continue;
        let end = from;
        while (end < cap && isOpenAt(end)) end += STEP_MS;
        if (end - from < 30 * 60000 || end < readyMs) continue;

        const day = Math.min(1, Math.max(0, Math.round((istDayStart(s) - today0) / DAY_MS)));
        if (perDay[day] >= maxPerDay) continue;
        perDay[day] += 1;
        slots.push({
            from: new Date(s).toISOString(),
            to: new Date(end).toISOString(),
            label: `${istFmt(isOpenAt(s) ? s : from)} – ${istFmt(end)}`,
            dayLabel: day === 0 ? 'Today' : 'Tomorrow',
            dateLabel: istDate(day === 0 ? nowMs : s),
        });
    }
    return { open: true, slots, message: slots.length ? null : 'No pickup time available' };
}

const findPickupSlot = (tenant, from) =>
    (typeof from === 'string' ? pickupSlots(tenant).slots.find((x) => x.from === from) : null) || null;

module.exports = { pickupSlots, findPickupSlot };