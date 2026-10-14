const IST = { timeZone: 'Asia/Kolkata' };

export const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const paise = (p) => rupees((Number(p) || 0) / 100);

export const dateTime = (d) => (d
    ? new Date(d).toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : '—');
export const dateOnly = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric' })
    : '—');

export const ago = (d) => {
    if (!d) return 'never';
    const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return dateOnly(d);
};

export const initials = (name = '') =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const titleCase = (s = '') => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// A calendar day (YYYY-MM-DD, India time) <-> the ISO time the server stores
export const ymdOf = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
export const isoOfYmd = (ymd, endOfDay = false) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? new Date(`${ymd}T${endOfDay ? '23:59:59' : '00:00:00'}+05:30`).toISOString() : undefined);

// paise in, readable rupees out ("₹1,250" / "₹12.50")
export const rupeesFromPaise = (p) => rupees((Number(p) || 0) / 100);
// rupees typed by a person -> whole paise
export const toPaise = (r) => Math.round((Number(r) || 0) * 100);
