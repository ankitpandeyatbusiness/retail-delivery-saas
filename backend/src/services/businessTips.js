// Plain-words tips from a shop's own numbers (services/businessReport.js), and the positive line at the end of the report.
// These are fixed rules, not AI, so they are predictable and cost nothing. Each tip says what we saw, what to do, and (when there is
// a place in the app for it) a button. Never more than 5, and never more than 2 worries, so a tired owner is not buried.
//   tone: good (a win) | watch (needs a look) | idea (a chance)
//   action.screen: a screen of the owner app (MenuTab, RidersTab, OwnerCoupons, OwnerMessages, OwnerBanners, OwnerCollections, Busy, OwnerReviews)

const rs = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const MAX = 5;
const MAX_WORRIES = 2;

function buildTips(r) {
    const tips = [];
    const add = (tone, priority, id, title, detail, action) => tips.push({ id, tone, priority, title, detail, ...(action ? { action } : {}) });
    const t = r.totals;
    const c = r.customers;

    if (!t.orders) {
        add('idea', 1, 'no-sales', 'No sales in this period yet',
            'Tell your friends and neighbours about your app, and make a first-order coupon so the first order feels like a gift.',
            { label: 'Make a coupon', screen: 'OwnerCoupons' });
        return tips;
    }

    if (r.change.revenue !== null && r.change.revenue >= 10 && t.orders >= 5) {
        add('good', 1, 'growth', `Sales are up ${r.change.revenue}%`, 'More than the period before. Keep your menu and timings steady, it is working.');
    }
    if (r.change.revenue !== null && r.change.revenue <= -15 && r.previous.orders >= 10) {
        add('watch', 0, 'drop', `Sales are down ${Math.abs(r.change.revenue)}%`,
            'Check your opening hours and items that are sold out, then tell your customers about an offer.',
            { label: 'Send an offer', screen: 'OwnerMessages' });
    }
    if (r.busiest.hour !== null && t.orders >= 20) {
        add('idea', 2, 'peak', `Your busiest time is ${r.busiest.weekday} around ${r.busiest.hourLabel}`,
            'Have your riders online and your best sellers in stock just before that time.', { label: 'Riders', screen: 'RidersTab' });
    }
    const topItem = r.food.top[0];
    if (topItem && topItem.quantity >= 10) {
        add('idea', 2, 'bestseller', `"${topItem.name}" is your best seller (${topItem.quantity} sold)`,
            'Mark it as a Bestseller and put it in a combo with a drink or a side. That lifts what each customer spends.',
            { label: 'Open the menu', screen: 'MenuTab' });
    }
    const loved = r.food.loved[0];
    if (loved && loved.avg >= 4.5 && loved.count >= 3) {
        add('good', 2, 'loved', `Customers love "${loved.name}" (${loved.avg} stars)`,
            'Use its picture on a banner. People trust a dish that other people already enjoy.', { label: 'Make a banner', screen: 'OwnerBanners' });
    }
    const worst = r.food.attention[0];
    if (worst) {
        add('watch', 0, 'attention', `"${worst.name}" is rated ${worst.avg} by ${worst.count} customers`,
            'Taste it yourself and check the portion. If it cannot be fixed this week, take it off the menu for now.', { label: 'Open the menu', screen: 'MenuTab' });
    }
    if (r.food.slow.length >= 4) {
        add('idea', 3, 'slow', `${r.food.slow.length} items did not sell at all`,
            'A shorter menu is easier to order from. Hide the ones nobody orders, or give one of them a special price.', { label: 'Open the menu', screen: 'MenuTab' });
    }
    if (t.placed >= 15 && t.cancelRate >= 8) {
        add('watch', 0, 'cancel', `${t.cancelRate}% of orders were cancelled (${rs(t.cancelledLost)} lost)`,
            'Cancellations usually happen when the kitchen is rushed. Switch on Busy mode so customers expect a longer wait.', { label: 'Busy mode', screen: 'Busy' });
    }
    if (c.unique >= 15 && c.repeatPct < 25) {
        add('idea', 1, 'repeat-low', `Only ${c.repeatPct}% of your customers ordered again`,
            'A small offer or a reminder to people who have not ordered for a while brings many of them back.', { label: 'Make a coupon', screen: 'OwnerCoupons' });
    }
    if (c.unique >= 15 && c.repeatPct >= 40) {
        add('good', 1, 'repeat-high', `${c.repeatPct}% of your customers order again`, 'That is real loyalty. Thank them with a small surprise now and then.');
    }
    if (c.newCount >= 5) {
        add('good', 2, 'new', `${c.newCount} new customers found you`, 'Make sure their first order was good: a quick thank-you message helps them come back.', { label: 'Send a message', screen: 'OwnerMessages' });
    } else if (t.orders >= 10 && c.newCount < 3) {
        add('idea', 3, 'new-low', 'Very few new customers this time', 'A first-order coupon and a banner on your home screen invite new people to try you.', { label: 'Make a coupon', screen: 'OwnerCoupons' });
    }
    const best = r.delivery.best;
    if (best && best.deliveries >= 5) {
        add('good', 3, 'rider-best', `${best.name} is your best rider (${best.deliveries} deliveries${best.avgMin ? `, about ${Math.round(best.avgMin)} min each` : ''})`,
            'Give the busiest hours to your best rider and say thank you.', { label: 'Riders', screen: 'RidersTab' });
    }
    const slowest = [...r.delivery.riders].filter((x) => x.deliveries >= 5 && x.avgMin).sort((a, b) => b.avgMin - a.avgMin)[0];
    if (slowest && best && slowest.riderId !== best.riderId && slowest.avgMin >= 40 && slowest.avgMin > (best.avgMin || 0) * 1.5) {
        add('watch', 1, 'rider-slow', `${slowest.name} takes about ${Math.round(slowest.avgMin)} minutes a delivery`, 'Talk to him about routes, or give him nearer orders.', { label: 'Riders', screen: 'RidersTab' });
    }
    if (r.delivery.rating.count >= 5 && r.delivery.rating.avg !== null && r.delivery.rating.avg < 4) {
        add('watch', 1, 'delivery-rating', `Delivery is rated ${r.delivery.rating.avg} of 5`, 'See what customers wrote and fix the most common complaint first.', { label: 'See reviews', screen: 'OwnerReviews' });
    }
    if (r.delivery.cashWithRidersPaise >= 100000) {
        add('watch', 2, 'cash', `${rs(r.delivery.cashWithRidersPaise / 100)} of cash is still with riders`, 'Collect it today so it does not pile up.', { label: 'Riders', screen: 'RidersTab' });
    }

    // good news first, then chances, and no more than two worries
    const weight = { good: 0, idea: 1, watch: 2 };
    const sorted = tips.sort((a, b) => a.priority - b.priority || weight[a.tone] - weight[b.tone]);
    const out = [];
    let worries = 0;
    for (const x of sorted) {
        if (x.tone === 'watch') { if (worries >= MAX_WORRIES) continue; worries += 1; }
        out.push(x);
        if (out.length >= MAX) break;
    }
    return out;
}

const QUOTES = [
    'Every order is a customer who chose you today.',
    'Small steps every day build a big shop.',
    'A happy customer is your best advertisement.',
    'Good food and a smile bring people back.',
    'Today is a fresh chance to make someone\'s meal better.',
    'Consistency beats luck. Keep showing up.',
    'Your hard work is visible in every order delivered.',
    'Great shops are built one repeat customer at a time.',
    'Be proud of what you cook. People can taste the care.',
    'Busy days are good days. Thank your team.',
    'Quiet days are for planning the next busy one.',
    'Every review is a gift, even the honest ones.',
    'The best time to improve one small thing is today.',
    'Your shop is feeding people and building trust.',
    'Fast, fresh, friendly. That is the whole secret.',
    'A loyal customer is worth ten new ones.',
    'You started something. That already puts you ahead.',
    'Success is many small wins in a row. You are collecting them.',
    'Treat every order like it is the first one of a new regular.',
    'Customers do not just buy food. They buy how you make them feel.',
    'Progress, not perfection. Look how far you have come.',
    'Your menu tells a story. Make it a delicious one.',
    'When in doubt, serve it hot and on time.',
    'A shop that keeps improving never runs out of customers.',
    'Thank you for working hard for your family and your team.',
];

// the same line for the same shop and period, a different one each time the period changes
function quoteFor(seed) {
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return QUOTES[h % QUOTES.length];
}

module.exports = { buildTips, quoteFor, QUOTES };
