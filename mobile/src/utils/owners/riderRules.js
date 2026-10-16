// Small pure helpers for the rider screens (kept free of React so they are easy to check).

// 12550 paise -> "₹125.50"; whole rupees have no decimals: 12500 -> "₹125"
export function rupees(paise) {
    const r = (Number(paise) || 0) / 100;
    const whole = Math.abs(r - Math.round(r)) < 0.005;
    return `₹${(whole ? Math.round(r) : r).toLocaleString('en-IN', whole ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// what the owner typed in rupees (may have paise) -> whole paise, or null when it is not an amount
export function toPaise(x) {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) return null;
    const p = Math.round(n * 100);
    return p > 0 && p <= 10000000 ? p : null;
}

// "5 min ago", "2 h ago", "3 days ago"
export function ago(date, now = Date.now()) {
    if (!date) return '';
    const m = Math.max(0, Math.round((now - new Date(date).getTime()) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    const d = Math.round(m / 1440);
    return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

// "Ravi" or, for a rider with no name yet, his phone's last digits
export const riderName = (r) => r?.name || (r?.phone ? `Rider ${String(r.phone).slice(-4)}` : 'Rider');

// ledger line -> [title, sign] ; sign +1 rider owes more, -1 owes less
export function ledgerLine(row) {
    if (row.type === 'collect') return [row.orderNo ? `Cash collected, order #${row.orderNo}` : 'Cash collected', 1];
    if (row.type === 'handover') return ['Cash given to the shop', -1];
    return ['Correction', row.amountPaise >= 0 ? 1 : -1];
}

// date range for the performance screen: last N days, or this month
export function rangeOf(id, now = new Date()) {
    const ist = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const to = ist(now);
    if (id === 'month') return { from: `${to.slice(0, 8)}01`, to };
    const days = id === '7' ? 7 : 30;
    return { from: ist(new Date(now.getTime() - (days - 1) * 86400000)), to };
}
