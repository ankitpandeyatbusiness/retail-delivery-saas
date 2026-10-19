// A short line about what is in an order, for notifications: "2× Butter Naan, Paneer Butter Masala (Full) +2 more".
// Two dishes at most, long names are cut, so a push stays one or two lines on the lock screen.
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function lineBrief(line) {
    const name = cut(clean(line.name || line.title), 24);
    const pick = (line.selections || []).map((x) => clean(x.name)).filter(Boolean)[0];   // Half / Full / the first choice
    const what = pick ? `${name} (${cut(pick, 12)})` : name;
    if (line.measure?.label) return `${clean(line.measure.label)} ${what}`;
    return line.quantity > 1 ? `${line.quantity}× ${what}` : what;
}

function brief(order, max = 2) {
    const items = Array.isArray(order?.items) ? order.items : [];
    if (!items.length) return '';
    const shown = items.slice(0, max).map(lineBrief);
    const rest = items.length - shown.length;
    return `${shown.join(', ')}${rest > 0 ? ` +${rest} more` : ''}`;
}

const rupees = (n) => `₹${Math.round(Number(n) || 0)}`;
const payWord = (order) => (order?.payment?.method === 'cod' ? 'Cash on delivery' : order?.payment?.status === 'paid' ? 'Paid online' : '');
const typeWord = (t) => ({ pickup: 'Pickup', dine_in: 'Dine-in', delivery: 'Delivery' }[t] || '');

module.exports = { brief, rupees, payWord, typeWord };
