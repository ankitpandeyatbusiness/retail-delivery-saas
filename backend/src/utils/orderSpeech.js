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
    if (p.method === 'cod') return 'Cash on delivery';
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
    const parts = [TYPE_WORDS[order.orderType] ? `New ${TYPE_WORDS[order.orderType].toLowerCase()}.` : 'New order.'];
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
    if (p.method === 'cod') return 'कैश ऑन डिलीवरी।';
    if (p.status === 'paid') return 'ऑनलाइन पेमेंट हो चुका है।';
    return '';
}

function orderSpeechHi(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const shown = items.slice(0, MAX_ITEMS).map(lineSpeech);
    const rest = items.length - shown.length;
    if (rest > 0) shown.push(`और ${rest} आइटम`);

    const total = Math.round(Number(order.pricing?.total) || 0);
    const parts = [HI_TYPE[order.orderType] || 'नया ऑर्डर।'];
    if (shown.length) parts.push(`${shown.join(', ')}।`);
    if (total > 0) parts.push(`कुल ${total} रुपये।`);
    const pay = paymentSpeechHi(order);
    if (pay) parts.push(pay);
    return parts.join(' ');
}

module.exports = { orderSpeech, orderSpeechHi, MAX_ITEMS };
