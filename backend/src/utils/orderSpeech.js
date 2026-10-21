// The sentence the owner's phone reads out loud when an order arrives (Soundbox mode):
//   "New order. 2 Butter Naan, 1 Laccha Paratha, 1 Paneer Butter Masala, Full. Total 540 rupees. Cash on delivery."
// It is built here, on the server, so the phone only has to speak it. Plain words only: no symbols, no "Rs".
// A long order is shortened: the first MAX_ITEMS lines, then "and 3 more items".

const MAX_ITEMS = 5;

const clean = (s) => String(s || '').replace(/[#*_()[\]{}<>|\\/]+/g, ' ').replace(/\s+/g, ' ').trim();

// one line of the order, as it is said: "2 Butter Naan", "1 Paneer Butter Masala, Full", "500 grams Basmati Rice"
function lineSpeech(line) {
    const name = clean(line.name);
    const picked = (line.selections || [])
        .map((s) => clean(s.name))
        .filter(Boolean)
        .slice(0, 3);
    const tail = picked.length ? `, ${picked.join(', ')}` : '';
    if (line.measure?.label) return `${clean(line.measure.label)} ${name}${tail}`;
    return `${line.quantity} ${name}${tail}`;
}

function paymentSpeech(order) {
    const p = order.payment || {};
    if (p.method === 'cod') return order.orderType === 'dine_in' ? 'Cash at the counter' : order.orderType === 'pickup' ? 'Cash on pickup' : 'Cash on delivery';
    if (p.status === 'paid') return 'Paid online';
    return '';
}

const TYPE_WORDS = { pickup: 'Pickup order', dine_in: 'Dine in order' };

function orderSpeech(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(`and ${rest} more ${rest === 1 ? 'item' : 'items'}`);

    const total = Math.round(Number(order.pricing?.total) || 0);
    const parts = [order.orderType === 'dine_in' && order.tableNo ? `New dine in order for table ${order.tableNo}.` : TYPE_WORDS[order.orderType] ? `New ${TYPE_WORDS[order.orderType].toLowerCase()}.` : 'New order.'];
    if (shown.length) parts.push(`${shown.join(', ')}.`);
    if (total > 0) parts.push(`Total ${total} rupees.`);
    const pay = paymentSpeech(order);
    if (pay) parts.push(`${pay}.`);
    return parts.join(' ');
}

// The same sentence in Hindi (Devanagari), for owners who choose a Hindi voice. Dish names stay as the shop wrote them:
// a Hindi voice reads "Butter Naan" fine, and the owner knows the menu by those names.
const HI_TYPE = { pickup: 'नया पिकअप ऑर्डर।', dine_in: 'नया डाइन इन ऑर्डर।' };

function paymentSpeechHi(order) {
    const p = order.payment || {};
    if (p.method === 'cod') return order.orderType === 'dine_in' ? 'काउंटर पर कैश।' : order.orderType === 'pickup' ? 'पिकअप पर कैश।' : 'कैश ऑन डिलीवरी।';
    if (p.status === 'paid') return 'ऑनलाइन पेमेंट हो चुका है।';
    return '';
}

function orderSpeechHi(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(`और ${rest} आइटम`);

    const total = Math.round(Number(order.pricing?.total) || 0);
    const parts = [order.orderType === 'dine_in' && order.tableNo ? `टेबल ${order.tableNo} के लिए नया डाइन इन ऑर्डर।` : HI_TYPE[order.orderType] || 'नया ऑर्डर।'];
    if (shown.length) parts.push(`${shown.join(', ')}।`);
    if (total > 0) parts.push(`कुल ${total} रुपये।`);
    const pay = paymentSpeechHi(order);
    if (pay) parts.push(pay);
    return parts.join(' ');
}

// A cancelled order, said with the same detail as a new one: who cancelled it, what was in it, the total and how it was paid.
//   who: 'customer' | 'rider' | 'system' (not accepted in time) | 'late' (more than an hour late) | '' (unknown)
const WHO = {
    customer: ' by the customer', rider: ' by the delivery partner', system: ' because it was not accepted in time',
    late: ' because the delivery was more than an hour late', '': '',
};
const WHO_HI = {
    customer: 'ग्राहक ने', rider: 'डिलीवरी पार्टनर ने', system: 'समय पर स्वीकार न होने से', late: 'एक घंटे से ज़्यादा देरी होने से', '': '',
};

function cancelSpeech(order, who = '') {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(`and ${rest} more ${rest === 1 ? 'item' : 'items'}`);
    const total = Math.round(Number(order.pricing?.total) || 0);
    const parts = [`Order ${order.orderNo} was cancelled${WHO[who] ?? ''}.`];
    if (shown.length) parts.push(`${shown.join(', ')}.`);
    if (total > 0) parts.push(`Total ${total} rupees.`);
    const pay = paymentSpeech(order);
    if (pay) parts.push(`${pay}.`);
    return parts.join(' ');
}

function cancelSpeechHi(order, who = '') {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(`और ${rest} आइटम`);
    const total = Math.round(Number(order.pricing?.total) || 0);
    // a person cancelled it: "ग्राहक ने ऑर्डर 12 रद्द कर दिया". A reason: "समय पर स्वीकार न होने से ऑर्डर 12 रद्द हो गया"
    const doer = who === 'customer' || who === 'rider';
    const parts = [`${WHO_HI[who] ? `${WHO_HI[who]} ` : ''}ऑर्डर ${order.orderNo} ${doer ? 'रद्द कर दिया।' : 'रद्द हो गया।'}`];
    if (shown.length) parts.push(`${shown.join(', ')}।`);
    if (total > 0) parts.push(`कुल ${total} रुपये।`);
    const pay = paymentSpeechHi(order);
    if (pay) parts.push(pay);
    return parts.join(' ');
}

// ---- what the COOK hears: where the food is going, the dishes, and what the guest asked for. Never money, never a phone number.
//   "New order for table 2, bill B. 1 Chicken Wings, 2 Paneer Butter Masala. Chicken Wings: less spicy. Note: no onion."
const noteOf = (order) => clean(order.note).slice(0, 140);
const lineNotes = (order) => (Array.isArray(order.items) ? order.items : []).filter((l) => clean(l.note)).slice(0, 3).map((l) => `${clean(l.name)}: ${clean(l.note).slice(0, 80)}`);

function whereSpeech(order, hi) {
    const bill = order.tableParty ? (hi ? `, बिल ${order.tableParty}` : `, bill ${order.tableParty}`) : '';
    if (order.orderType === 'dine_in') return hi ? `टेबल ${order.tableNo || ''}${bill} के लिए नया ऑर्डर।` : `New order for table ${order.tableNo || ''}${bill}.`;
    if (order.orderType === 'pickup') return hi ? 'नया पिकअप ऑर्डर।' : 'New pickup order.';
    return hi ? 'नया डिलीवरी ऑर्डर।' : 'New delivery order.';
}

function kitchenSpeech(order, hi = false) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(hi ? `और ${rest} आइटम` : `and ${rest} more ${rest === 1 ? 'item' : 'items'}`);
    const parts = [whereSpeech(order, hi)];
    if (shown.length) parts.push(`${shown.join(', ')}${hi ? '।' : '.'}`);
    for (const n of lineNotes(order)) parts.push(`${n}${hi ? '।' : '.'}`);
    const note = noteOf(order);
    if (note) parts.push(hi ? `विशेष निर्देश: ${note}।` : `Note: ${note}.`);
    return parts.join(' ');
}

// a cancelled order, for the cook: which one, where it was going and what it was, so he stops the right pan
function kitchenCancelSpeech(order, hi = false) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(hi ? `और ${rest} आइटम` : `and ${rest} more ${rest === 1 ? 'item' : 'items'}`);
    const where = order.orderType === 'dine_in' ? (hi ? ` टेबल ${order.tableNo || ''}।` : ` Table ${order.tableNo || ''}.`) : order.orderType === 'pickup' ? (hi ? ' पिकअप।' : ' Pickup.') : (hi ? ' डिलीवरी।' : ' Delivery.');
    const head = hi ? `ऑर्डर ${order.orderNo} रद्द हुआ। इसे मत बनाइए।` : `Order ${order.orderNo} is cancelled. Stop making it.`;
    return `${head}${where}${shown.length ? ` ${shown.join(', ')}${hi ? '।' : '.'}` : ''}`;
}

// ---- a pickup customer told the shop something: who, what, the dishes and the time he chose. No money.
const IST = (d) => new Date(new Date(d).getTime() + 330 * 60000);
const clock = (d) => { const t = IST(d); const h = t.getUTCHours(); const m = String(t.getUTCMinutes()).padStart(2, '0'); return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`; };
const INTENT_EN = { coming: 'is on the way', arrived: 'is here', on_time: 'will be there on time', late: 'is running late', more_time: 'needs more time' };
const INTENT_HI = { coming: 'रास्ते में हैं', arrived: 'पहुँच गए हैं', on_time: 'समय पर पहुँचेंगे', late: 'देर से आ रहे हैं', more_time: 'को और समय चाहिए' };
function pickupIntentSpeech(order, answer, hi = false) {
    const items = (Array.isArray(order.items) ? order.items : []).slice(0, MAX_ITEMS).map(lineSpeech);
    const who = clean(order.customer?.name).split(' ')[0] || (hi ? 'ग्राहक' : 'The customer');
    const parts = [hi ? `पिकअप ऑर्डर ${order.orderNo}।` : `Pickup order ${order.orderNo}.`, hi ? `${who} ${INTENT_HI[answer] || ''}।` : `${who} ${INTENT_EN[answer] || 'sent a message'}.`];
    if (items.length) parts.push(`${items.join(', ')}${hi ? '।' : '.'}`);
    if (order.scheduledFor) parts.push(hi ? `पिकअप का समय ${clock(order.scheduledFor)}।` : `Pickup time ${clock(order.scheduledFor)}.`);
    return parts.join(' ');
}

module.exports = { orderSpeech, orderSpeechHi, cancelSpeech, cancelSpeechHi, kitchenSpeech, kitchenCancelSpeech, pickupIntentSpeech, MAX_ITEMS };
