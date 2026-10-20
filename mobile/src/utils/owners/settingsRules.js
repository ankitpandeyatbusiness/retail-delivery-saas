// Pure helpers for the shop settings screens: weekly hours, holidays, delivery fee, the activity log wording, and the
// closing report as a message to share.
import { rupees } from './riderRules';

/* ------------------------------ opening hours ------------------------------ */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_SLOTS = 3;
export const MAX_HOLIDAYS = 30;

// server weekly ({ mon:[{open,close}] } or empty = always open) -> { hasHours, days:{ mon:[{open,close}] } }
export function weeklyToForm(weekly) {
    const has = !!weekly && Object.keys(weekly).length > 0;
    const days = {};
    for (const d of DAY_KEYS) days[d] = has ? (weekly[d] || []).map((s) => ({ open: s.open, close: s.close })) : [{ open: '09:00', close: '22:00' }];
    return { hasHours: has, days };
}

// -> the weekly the server wants: every day present, an empty list = closed; no hours at all = {}
export function formToWeekly(form) {
    if (!form.hasHours) return {};
    return Object.fromEntries(DAY_KEYS.map((d) => [d, form.days[d].map((s) => ({ open: s.open, close: s.close }))]));
}

// first problem with the hours form, or null
export function hoursProblem(form) {
    if (!form.hasHours) return null;
    for (const d of DAY_KEYS) {
        for (const s of form.days[d]) if (!TIME.test(s.open) || !TIME.test(s.close)) return `${DAY_NAMES[d]}: use 24-hour time like 09:30`;
    }
    if (DAY_KEYS.every((d) => !form.days[d].length)) return 'Every day is closed. Switch hours off, or open at least one day.';
    return null;
}

export function holidaysProblem(list) {
    for (const [i, h] of list.entries()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(h.from) || !/^\d{4}-\d{2}-\d{2}$/.test(h.to)) return `Holiday ${i + 1}: type dates as 2026-11-01`;
        if (h.to < h.from) return `Holiday ${i + 1}: the last day is before the first day`;
    }
    return null;
}

// "09:00–22:00, 18:00–02:00"
export const slotsText = (slots) => (slots.length ? slots.map((s) => `${s.open}–${s.close}`).join(', ') : 'Closed');

/* ------------------------------ delivery fee ------------------------------ */
export const FEE_TYPES = [['free', 'Free'], ['flat', 'Same for all'], ['distance', 'By distance']];

export function feeText(fee = {}, packaging = 0) {
    let t;
    if (fee.type === 'flat') t = `₹${fee.amount || 0} delivery${fee.freeAbove ? `, free above ₹${fee.freeAbove}` : ''}`;
    else if (fee.type === 'distance') t = `₹${fee.baseFee || 0} for the first ${fee.baseKm || 0} km, then ₹${fee.perKmFee || 0} per km${fee.maxFee ? ` (up to ₹${fee.maxFee})` : ''}`;
    else t = 'Free delivery';
    return packaging ? `${t} · ₹${packaging} packaging` : t;
}

export function feeProblem(v) {
    const n = (x) => x === undefined || (Number.isFinite(x) && x >= 0);
    if (v.type === 'flat' && !(v.amount >= 0)) return 'Enter the delivery fee';
    if (v.type === 'distance') {
        if (!(v.baseFee >= 0) || !(v.baseKm >= 0) || !(v.perKmFee >= 0)) return 'Enter the first-km fee, the first km and the fee per km';
        if (v.maxFee !== undefined && v.maxFee > 0 && v.maxFee < v.baseFee) return 'The highest fee cannot be lower than the first-km fee';
    }
    if (!n(v.freeAbove) || !n(v.packaging) || !n(v.minOrder)) return 'Amounts cannot be negative';
    if (v.tips.some((t) => !(t >= 0 && t <= 500))) return 'A tip is from ₹0 to ₹500';
    if (v.radiusKm !== undefined && !(v.radiusKm > 0 && v.radiusKm <= 100)) return 'Delivery distance is from 1 to 100 km';
    return null;
}

/* ------------------------------ busy mode ------------------------------ */
export const BUSY_EXTRA = [[15, '+15 min'], [30, '+30 min'], [45, '+45 min'], [60, '+1 hour']];
export const BUSY_FOR = [
    ['m60', 'For 1 hour', { minutes: 60 }],
    ['m120', 'For 2 hours', { minutes: 120 }],
    ['morning', 'Until tomorrow morning', { untilMorning: true }],
];

/* ------------------------------ activity log ------------------------------ */
// the server stores "PUT /api/shop/settings" style actions; the owner reads plain words
const ACTIVITY = [
    [/staff\/kitchen\/orders\/:id\/start/, 'Started cooking an order'], [/staff\/kitchen\/orders\/:id\/ready/, 'Marked an order ready'], [/staff\/kitchen\/orders\/:id\/problem/, 'Told you about a problem in the kitchen'],
    [/staff\/waiter\/orders\/:id\/serve/, 'Served a dish'], [/staff\/waiter\/requests/, 'Finished a table request'], [/staff\/waiter\/tables\/:sessionId\/settle/, 'Took the money for a table bill'], [/staff\/me/, 'Changed their own name'],
    [/shop\/staff/, 'Changed the staff list'],
    [/^BROADCAST/, 'Sent a message'], [/^COMPLAINT_DECISION/, 'Answered a complaint'], [/^LOGIN/, 'Logged in'],
    [/accepting-orders/, 'Paused or resumed orders'], [/\/busy/, 'Changed busy mode'],
    [/settings/, 'Changed shop settings'], [/products\/:id\/stock/, 'Changed stock'], [/products\/:id\/availability/, 'Changed an item\'s availability'],
    [/products/, 'Changed the menu'], [/categories/, 'Changed a category'], [/collections/, 'Changed a collection'],
    [/banners/, 'Changed a banner'], [/coupons/, 'Changed a coupon'],
    [/riders/, 'Changed riders'], [/cod/, 'Recorded rider cash'], [/assign/, 'Gave an order to a rider'],
    [/orders\/:id\/status/, 'Changed an order'], [/customers/, 'Changed a customer'], [/sms/, 'SMS balance'], [/uploads/, 'Uploaded a picture'],
];
export function activityLabel(action = '') {
    const hit = ACTIVITY.find(([re]) => re.test(action));
    if (hit) return hit[1];
    return String(action).replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\/api\/(shop\/)?/, '').replace(/[/:_-]+/g, ' ').trim() || 'Change';
}
export const ACTOR_FILTERS = [['', 'Everyone'], ['owner', 'You'], ['rider', 'Riders'], ['staff', 'Staff'], ['superadmin', 'Platform'], ['system', 'Automatic']];

/* ------------------------------ closing report as a message ------------------------------ */
const PAY = { cod: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet' };
const rs = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export function closingText(r, shopName) {
    const lines = [
        `${shopName || 'Shop'} · closing report · ${r.date}`,
        '',
        `Sales: ${rs(r.sales.revenue)} from ${r.sales.orders} ${r.sales.orders === 1 ? 'order' : 'orders'}${r.sales.orders ? ` (average ${rs(r.sales.averageOrder)})` : ''}`,
    ];
    for (const p of r.payments) lines.push(`  ${PAY[p.method] || p.method}: ${rs(p.total)} (${p.orders})`);
    lines.push(`Orders: ${r.orders.placed} placed, ${r.orders.delivered} delivered, ${r.orders.cancelled} cancelled${r.orders.undelivered ? `, ${r.orders.undelivered} not delivered` : ''}`);
    if (r.sales.tips) lines.push(`Tips: ${rs(r.sales.tips)}`);
    lines.push(`Cash collected by riders: ${rupees(r.cash.collectedByRidersPaise)} (still with riders: ${rupees(r.cash.withRidersNowPaise)})`);
    if (r.online.receivedCount || r.online.refundedCount) lines.push(`Online: received ${rupees(r.online.receivedPaise)}, refunded ${rupees(r.online.refundedPaise)}`);
    if (r.topItems.length) lines.push('', 'Best sellers:', ...r.topItems.map((i) => `  ${i.name} × ${i.quantity}`));
    if (r.complaints) lines.push('', `Complaints today: ${r.complaints}`);
    return lines.join('\n');
}
