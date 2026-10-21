// The Transactions tab: the periods, the names and icons of each kind of money movement, and India-time dates.
const IST_MS = 330 * 60000;
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const istToday = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
export const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const monthOf = (s) => s.slice(0, 7);
export const dateStr = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const dayLabel = (s) => { const t = new Date(Date.parse(s + 'T00:00:00Z')); return `${DAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
export const shortDay = (s) => { const t = new Date(Date.parse(s + 'T00:00:00Z')); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };

const ist = (at) => new Date(new Date(at).getTime() + IST_MS);
export const dayKey = (at) => ist(at).toISOString().slice(0, 10);
export const timeOf = (at, seconds) => { const t = ist(at); const h = t.getUTCHours(); return `${h % 12 || 12}:${pad(t.getUTCMinutes())}${seconds ? ':' + pad(t.getUTCSeconds()) : ''} ${h < 12 ? 'am' : 'pm'}`; };
export const fullStamp = (at) => `${shortDay(dayKey(at))}, ${timeOf(at, true)}`;

export const PERIODS = [
    ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month'], ['lastmonth', 'Last month'],
    ['day', 'Pick a day'], ['monthpick', 'Pick a month'], ['range', 'Date range'], ['all', 'All time'],
];

// the server's date filter for a period ('pick' holds what was chosen on the calendar)
export function periodParams(period, pick = {}) {
    const today = istToday();
    switch (period) {
        case 'today': return { date: today };
        case 'yesterday': return { date: addDays(today, -1) };
        case 'week': return { from: addDays(today, -6), to: today };
        case 'month': return { month: monthOf(today) };
        case 'lastmonth': return { month: monthOf(addDays(today.slice(0, 8) + '01', -1)) };
        case 'day': return pick.date ? { date: pick.date } : { date: today };
        case 'monthpick': return pick.month ? { month: pick.month } : { month: monthOf(today) };
        case 'range': return pick.from ? { from: pick.from, to: pick.to || pick.from } : { from: addDays(today, -6), to: today };
        default: return {};
    }
}
export function periodTitle(period, pick = {}) {
    const p = periodParams(period, pick);
    if (p.date) return p.date === istToday() ? 'Today' : shortDay(p.date);
    if (p.month) return monthLabel(p.month);
    if (p.from) return p.from === p.to ? shortDay(p.from) : `${shortDay(p.from)} to ${shortDay(p.to)}`;
    return 'All time';
}

export const KIND = {
    online: { icon: 'phone-portrait', label: 'Online payment' },
    cash_delivery: { icon: 'bicycle', label: 'Paid to the rider at the door' },
    cash_pickup: { icon: 'bag-handle', label: 'Paid at pickup' },
    table_bill: { icon: 'restaurant', label: 'Table bill paid at the counter' },
    table_share: { icon: 'people', label: 'Guest paid their share' },
    earlier_bill: { icon: 'time', label: 'Earlier unpaid bill cleared' },
    table_online: { icon: 'phone-portrait', label: 'Unpaid table bill paid online' },
    refund_online: { icon: 'arrow-undo', label: 'Refund to customer' },
    refund_cash: { icon: 'cash', label: 'Refund you gave' },
    dispute_lost: { icon: 'warning', label: 'Chargeback lost' },
    sms_topup: { icon: 'chatbubble-ellipses', label: 'SMS top-up' },
    rent: { icon: 'receipt', label: 'Your monthly bill' },
};
export const KIND_CHIPS = [['', 'All types'], ...Object.entries(KIND).map(([k, v]) => [k, v.label])];
export const HOW_CHIPS = [['', 'Any way'], ['online', 'Online'], ['cash', 'Cash'], ['upi', 'UPI to you']];
export const DIRECTION_CHIPS = [['', 'In and out'], ['in', 'Money in'], ['out', 'Money out']];

// the line under the title of a row: the order, the table, the person
export function subtitle(x) {
    const bits = [];
    if (x.orderNo) bits.push(`Order #${x.orderNo}`);
    if (x.table) bits.push(`Table ${x.table}${x.party ? ' ' + x.party : ''}`);
    if (x.customer) bits.push(x.customer);
    if (x.category === 'rent' && x.meta?.period) bits.push(monthLabel(x.meta.period));
    if (x.category === 'sms_topup' && x.note) bits.push(x.note);
    return bits.join(' · ') || x.by || '';
}
