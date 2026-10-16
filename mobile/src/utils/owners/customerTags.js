// How a customer's standing is shown (the server works out the tag: backend/src/services/customerInsights.js).
export const TAGS = {
    new: { label: 'New', hint: 'First order in the last 2 weeks', color: '#2E7D32' },
    regular: { label: 'Regular', hint: 'Orders now and then', color: '#1565C0' },
    loyal: { label: 'Loyal', hint: '5 or more orders', color: '#6A1B9A' },
    vip: { label: 'VIP', hint: '10 or more orders', color: '#B8860B' },
    slipping: { label: 'Slipping', hint: 'Has not ordered for longer than usual. Remind these first.', color: '#E65100' },
    lost: { label: 'Lost', hint: 'Has not ordered for a long time', color: '#B71C1C' },
};
export const TAG_ORDER = ['slipping', 'lost', 'new', 'regular', 'loyal', 'vip'];

// "orders around 8 PM on Fridays, likes Paneer Roll"
export function usualLine(c) {
    const parts = [];
    if (c.usualHourLabel) parts.push(`orders around ${c.usualHourLabel}${c.usualDay ? ` on ${c.usualDay}s` : ''}`);
    if (c.favourites?.[0]) parts.push(`likes ${c.favourites[0].name}`);
    return parts.length ? parts.join(', ') : 'no orders yet';
}

export const sinceLine = (c) => (c.orders ? (c.daysSince <= 0 ? 'ordered today' : `last order ${c.daysSince} day${c.daysSince === 1 ? '' : 's'} ago`) : 'no orders yet');
