// Pure helpers for the Money screens. Amounts: the sales report is in RUPEES, wallet / payments / bills are in PAISE.

const istDay = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);

export const PERIODS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month']];

// -> { from, to } as YYYY-MM-DD in India time
export function periodRange(id, now = new Date()) {
    const to = istDay(now);
    if (id === 'today') return { from: to, to };
    if (id === 'month') return { from: `${to.slice(0, 8)}01`, to };
    const days = id === '7' ? 7 : 30;
    return { from: istDay(new Date(now.getTime() - (days - 1) * 86400000)), to };
}

// "2026-10-16" -> "16 Oct"
export function shortDay(ymd) {
    const [, m, d] = String(ymd).split('-');
    return `${Number(d)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] || ''}`;
}

export const PAY_LABEL = { cod: 'Cash on delivery', upi: 'UPI', card: 'Card', wallet: 'Wallet' };

// money screens that can be filtered by what moved
export const MOVES = [['', 'All'], ['customer_payment', 'Received'], ['customer_refund', 'Refunds'], ['dispute_lost', 'Chargebacks'], ['sms_topup', 'SMS'], ['rent', 'Bills']];

export const REFUND_STATE = { pending: 'Asked', processing: 'On the way', processed: 'Done', failed: 'Failed' };
export const DISPUTE_STATE = { created: 'New', under_review: 'Under review', action_required: 'Needs an answer', won: 'Won', lost: 'Lost', closed: 'Closed' };

// "SMS used for an order alert" etc.
export function smsLine(t) {
    if (t.type === 'topup') return 'Top-up';
    if (t.type === 'refund') return 'Refund for a failed SMS';
    if (t.type === 'adjust') return t.note || 'Correction by support';
    return t.purpose ? `SMS: ${String(t.purpose).replace(/_/g, ' ')}` : 'SMS sent';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "2026-10" -> "October 2026"
export const monthName = (ym) => { const [y, m] = String(ym).split('-'); return `${MONTHS[Number(m) - 1] || ''} ${y}`; };
// "2026-10" -> { from: '2026-10-01', to: '2026-10-31' } (India dates)
export function monthRange(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
