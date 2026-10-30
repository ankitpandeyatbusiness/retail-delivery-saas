// The alerts a person can switch, grouped the way they think about them ("New orders", "A table calls"), and what each group may do.
//   n  notification   the phone alert (the push). Off: nothing reaches the phone; the message is still in the inbox.
//   p  popup          a box that opens over the app. Only where the app has one (can.p).
//   s  sound          the ring and the voice. Off: the push is silent and the app says nothing (can.s).
// Every group starts ON (the recommended settings). A person's own choices are stored as the difference from that (User.alertPrefs).
// `types`: the notification types in the group. `kinds`: the live alerts of the cook's and the waiter's screens. `sample`: what "Listen" says.
const g = (id, label, hint, types, o = {}) => ({
    id, label, hint, types, kinds: o.kinds || [],
    can: { n: true, p: !!o.p, s: true },   // every alert can have its sound switched
    soft: !!o.soft,   // news only: a soft ping, not the ting-tong
    critical: !!o.critical,   // switching it off asks "are you sure?": a missed one costs money or safety
    noVoice: !!o.noVoice,   // starts without the voice (the slider and the notification still come): the guests at the table must not hear it
    quiet: !!o.quiet,   // starts quiet: the notification only, no slider, no sound, no voice (the person can switch them on)
    defaults: { n: true, p: o.p === true, s: !o.quiet, ...(o.defaults || {}) },
    sample: o.sample ? { en: o.sample[0], hi: o.sample[1] } : null,
});

const OWNER = [
    g('new_orders', 'New orders', 'A new order is waiting for you to accept.', ['order_new', 'order_unaccepted_reminder'], { p: true, critical: true, sample: ['New order. 2 Butter Naan, 1 Paneer Butter Masala. Total 540 rupees. Cash on delivery.', 'नया ऑर्डर। 2 Butter Naan, 1 Paneer Butter Masala। कुल 540 रुपये। कैश ऑन डिलीवरी।'] }),
    g('cancelled', 'Cancelled orders', 'An order was cancelled by the customer, the rider or the system.', ['order_cancelled'], { p: true, sample: ['Order 1166 was cancelled by the customer. 1 Chicken Wings. Total 240 rupees.', 'ग्राहक ने ऑर्डर 1166 रद्द कर दिया। 1 Chicken Wings। कुल 240 रुपये।'] }),
    g('kitchen', 'Kitchen problems', 'The cook says a dish is finished or an order cannot be made.', ['kitchen_problem'], { p: true, sample: ['Kitchen problem. Order 1166. Chicken Wings is finished.', 'किचन में समस्या। ऑर्डर 1166।'] }),
    g('bill_reminders', 'A table finished eating', 'The guests finished eating and nobody has asked for the bill yet. No voice by default, so the guests at the table do not hear it.', ['table_check'], { noVoice: true, sample: ['Table 4 has finished eating.', 'टेबल 4 ने खाना खा लिया है।'] }),
    g('pickup', 'Pickup customers', 'A pickup customer says he is coming, is here, is late, or needs more time. Also: no-show, a later time, collected.', ['pickup_intent', 'pickup_no_show', 'pickup_time_request', 'pickup_collect_claim', 'pickup_not_wanted_claim'], { p: true, sample: ['Pickup order 1173. Ankit is on the way. 2 Butter Naan, 1 Paneer Butter Masala.', 'पिकअप ऑर्डर 1173। Ankit रास्ते में हैं। 2 Butter Naan, 1 Paneer Butter Masala।'] }),
    g('tables', 'Tables: calls and bills', 'A table calls, asks for the bill, says it paid, asks you to hurry or to cancel a round.', ['table_call', 'table_bill_asked', 'table_bill_waiting', 'table_ready_unserved', 'table_paid_owner', 'table_paid_online', 'table_closed_owner', 'table_nudge', 'table_paid_claim', 'order_cancel_request', 'table_share_ask', 'table_feedback_low'], { p: 'off', sample: ['Table 4 asked for the bill.', 'टेबल 4 ने बिल मांगा है।'] }),
    g('guest_alert', 'A guest who owes cannot be reached', 'A guest who still owes at a table cannot be reached, or has the phone location off. Quiet by default: no slider, sound or voice.', ['table_guest_alert'], { quiet: true, soft: true, sample: ['Table 4: the phone of Anil is not reachable. Keep an eye on the table.', 'टेबल 4: Anil का फ़ोन नहीं लग रहा। टेबल पर नज़र रखिए।'] }),
    g('bookings', 'Table bookings', 'A guest books a table, or cancels a booking.', ['booking_new', 'booking_cancelled'], { p: true, sample: ['New table booking for 4 guests, 2026-11-20 at 20:00. Anil.', 'नई टेबल बुकिंग, 4 मेहमान, 2026-11-20 को 20:00 बजे। Anil ने की है।'] }),
    g('booking_reminders', 'Table booking reminders', 'Half an hour before a booked table, so the table is ready.', ['booking_reminder'], { p: true, sample: ['A table booking in 30 minutes. Anil, 4 guests at 20:00.', 'आधे घंटे में टेबल बुकिंग है। Anil, 4 मेहमान, 20:00 बजे।'] }),
    g('inquiries', 'Service inquiries', 'A customer sends an inquiry for bulk order, tiffin, party booking or your own service, or writes again on one.', ['inquiry_new', 'inquiry_customer_reply', 'inquiry_unanswered'], { p: true, sample: ['New inquiry for Bulk Order Booking. Anil sent an inquiry for 30 guests.', 'बल्क ऑर्डर बुकिंग के लिए नई पूछताछ आई है। Anil ने भेजी है। 30 मेहमान।'] }),
    g('help', 'A rider asks for help', 'A delivery partner pressed the help button.', ['rider_sos'], { p: true, critical: true, sample: ['Ramesh needs help. Order 1173. Please call now.', 'Ramesh को मदद चाहिए। ऑर्डर 1173। अभी फ़ोन करें।'] }),
    g('delivery', 'Delivery news', 'A rider accepted, rejected or has a problem; nobody took an order; a delivery is late.', ['rider_accepted', 'rider_rejected', 'rider_none', 'delivery_pin_skipped', 'rider_problem', 'rider_quiet', 'rider_arrived_shop', 'delivery_late_warning', 'order_late', 'order_delivered_shop'], { p: 'off', soft: true }),
    g('leave', 'Leave requests', 'A cook, a waiter or a rider asks for leave.', ['staff_leave_request', 'staff_leave_withdrawn', 'rider_leave_request', 'rider_leave_withdrawn'], { p: true, soft: true }),
    g('holiday', 'Days off', 'A cook or a waiter put plain days off in their calendar.', ['staff_holiday'], { p: 'off', soft: true }),
    g('offduty', 'Staff comes on or goes off duty', 'A cook, a waiter or a rider came on duty, or switched themselves off duty.', ['staff_on_duty', 'staff_off_duty', 'rider_ended_duty'], { p: true, soft: true }),
    g('undo', 'Steps taken back (undo)', 'Someone undid Ready, Served or Picked up.', ['order_undone'], { p: 'off', soft: true }),
    g('reviews', 'Reviews and complaints', 'A new complaint, a review, or a low rating.', ['complaint_new', 'complaint_reminder', 'review_food', 'review_delivery', 'delivery_low_rating', 'dish_low_rating'], { p: 'off', soft: true }),
    g('money', 'Rent, money and SMS', 'Your rent bill, payments, and your SMS balance.', ['bill_issued', 'bill_reminder', 'bill_overdue', 'shop_paused', 'shop_unpaused', 'payment_received', 'sms_topup_done', 'sms_low', 'sms_zero', 'free_ending', 'platform_message'], { p: 'off', soft: true, critical: true }),
    g('reports', 'Daily and weekly reports', 'How today and last week went.', ['owner_daily_summary', 'owner_weekly_digest', 'monthly_report'], { p: 'off', soft: true }),
];

const RIDER = [
    g('offers', 'New delivery offers', 'An order is offered to you. You have {offer} to take it.', ['rider_offer', 'rider_assigned_owner'], { critical: true }),
    g('late', 'Late delivery warning', 'An order will be cancelled soon if it is not delivered.', ['delivery_late_warning_rider'], { p: true, critical: true, soft: true }),
    g('packed', 'Food is packed', 'The kitchen packed the order you are coming for.', ['food_packed_rider'], { p: 'off', soft: true }),
    g('thanks', 'Thanks, ratings and badges', 'A thank you, a review of your delivery, a new badge.', ['delivery_done_rider', 'review_delivery_rider', 'rider_badge'], { p: 'off', soft: true }),
    g('duty', 'Duty and leave', 'You were put on or off duty, or the shop answered your leave.', ['rider_off_duty', 'rider_duty_auto', 'rider_leave_decision', 'rider_leave_removed', 'rider_removed'], { p: 'off', soft: true }),
    g('undo', 'Steps taken back (undo)', 'Someone undid a step of your order.', ['order_undone'], { soft: true }),
];

const KITCHEN = [
    g('new', 'New orders', 'An order to make: where it goes, the dishes and the guest\'s note.', ['kitchen_new'], { kinds: ['new', 'queued'], critical: true, sample: ['New order for table 2. 1 Chicken Wings, 2 Paneer Butter Masala. Note: no onion.', 'टेबल 2 के लिए नया ऑर्डर। 1 Chicken Wings, 2 Paneer Butter Masala। विशेष निर्देश: प्याज़ नहीं।'] }),
    g('cancel', 'Cancelled orders', 'Stop making this order.', ['kitchen_cancelled'], { kinds: ['cancel'], p: true, critical: true, sample: ['Order 1166 is cancelled. Stop making it. Table 2. 1 Chicken Wings.', 'ऑर्डर 1166 रद्द हुआ। इसे मत बनाइए। टेबल 2। 1 Chicken Wings।'] }),
    g('hurry', 'A table is waiting', 'A guest pressed "please hurry".', ['kitchen_hurry'], { kinds: ['hurry'], sample: ['Table 4 is waiting.', 'टेबल 4 इंतज़ार कर रही है।'] }),
    g('waiting', 'An order is waiting or late', 'An order has waited too long to be started, or is taking too long to cook.', ['kitchen_nudge', 'kitchen_late'], { sample: ['Order 1166 is waiting. Please start it.', 'ऑर्डर 1166 इंतज़ार कर रहा है। कृपया शुरू कीजिए।'] }),
    g('here', 'A pickup customer is here', 'The customer for a pickup order has arrived.', [], { kinds: ['here'], sample: ['Pickup 1173, the customer is here.', 'पिकअप 1173, ग्राहक आ गया है।'] }),
    g('done', 'Handed over, collected or served', 'An order has left the kitchen. A soft ping only.', ['kitchen_done'], { kinds: ['done'], s: true }),
    g('undo', 'Steps taken back (undo)', 'Someone undid Served or Picked up.', ['order_undone'], { soft: true }),
    g('rating', 'Ratings for your food', 'A customer rated a dish you cooked.', ['food_rating_cook'], { soft: true }),
    g('leave', 'Answers to your leave', 'The owner approved or rejected your leave.', ['staff_leave_decision', 'staff_leave_removed'], { p: true, soft: true }),
];

const WAITER = [
    g('ready', 'Food ready to serve', 'The kitchen says a dish is ready for a table.', ['waiter_serve'], { kinds: ['ready'], critical: true, sample: ['Table 2, food is ready.', 'टेबल 2, खाना तैयार है।'] }),
    g('paid', 'A table paid online', 'A guest paid his bill online from his phone, so nobody walks over with a machine.', ['waiter_paid'], { kinds: ['paid'], sample: ['Anil paid 450 rupees online for table 4.', 'टेबल 4 ने 450 रुपये ऑनलाइन दे दिए।'] }),
    g('bill_reminder', 'A table finished eating', 'A table of yours finished eating and nobody has asked for the bill yet. No voice by default, so the guests at the table do not hear it.', ['waiter_bill_reminder'], { kinds: ['bill_reminder'], noVoice: true, sample: ['Table 4 has finished eating.', 'टेबल 4 ने खाना खा लिया है।'] }),
    g('call', 'A table calls', 'A guest asks for the waiter, water, a spoon or a clean table.', ['waiter_call'], { kinds: ['call'], sample: ['Table 4 is calling.', 'टेबल 4 बुला रही है।'] }),
    g('bill', 'A table wants the bill', 'A guest asked for the bill.', ['waiter_bill'], { kinds: ['bill'], sample: ['Table 4 wants the bill.', 'टेबल 4 को बिल चाहिए।'] }),
    g('booking', 'A booked table is coming', 'A table a guest booked is due in half an hour, so you can get it ready.', ['waiter_booking'], { sample: ['Table 4 is booked for 4 guests at 20:00. Anil.', 'टेबल 4, 4 मेहमान, 20:00 बजे के लिए बुक है। Anil।'] }),
    g('undo', 'Steps taken back (undo)', 'Someone undid Ready.', ['order_undone'], { soft: true }),
    g('leave', 'Answers to your leave', 'The owner approved or rejected your leave.', ['staff_leave_decision', 'staff_leave_removed'], { p: true, soft: true }),
];

// examples for "Listen" (and what the voice says) for the groups that had none
const SAMPLES = {
    'admin.delivery': ['Rider Ramesh accepted order 1173.', 'Rider Ramesh ने ऑर्डर 1173 स्वीकार किया।'],
    'admin.leave': ['Suresh, a waiter, asked for leave on 25 October.', 'वेटर Suresh ने 25 अक्टूबर की छुट्टी मांगी है।'],
    'admin.holiday': ['Ramesh, a cook, added a day off.', 'कुक Ramesh ने एक दिन की छुट्टी जोड़ी है।'],
    'admin.offduty': ['Suresh, a waiter, is off duty.', 'वेटर Suresh ड्यूटी से बाहर हैं।'],
    'admin.undo': ['Order 1173: Ready was undone.', 'ऑर्डर 1173: Ready वापस लिया गया।'],
    'admin.reviews': ['A new review for order 1173.', 'ऑर्डर 1173 का नया रिव्यू।'],
    'admin.money': ['Your monthly bill is ready.', 'आपका मासिक बिल तैयार है।'],
    'admin.reports': ['Your daily summary is ready.', 'आपका दैनिक सारांश तैयार है।'],
    'rider.offers': ['New delivery request. 2 Butter Naan. Collect 540 rupees. Accept within {offer}.', 'नई डिलीवरी रिक्वेस्ट। 2 Butter Naan। 540 रुपये लेने हैं। {offerHi} में स्वीकार करें।'],
    'rider.late': ['Order 1173 will be cancelled soon if it is not delivered.', 'ऑर्डर 1173 जल्द रद्द हो जाएगा अगर डिलीवर नहीं हुआ।'],
    'rider.packed': ['Order 1173 is packed. Come and collect it.', 'ऑर्डर 1173 पैक हो गया है। आकर ले जाइए।'],
    'rider.thanks': ['Thank you for delivering order 1173.', 'ऑर्डर 1173 डिलीवर करने के लिए धन्यवाद।'],
    'rider.duty': ['You were put off duty.', 'आपको ड्यूटी से हटाया गया है।'],
    'rider.undo': ['Order 1173: Picked up was undone.', 'ऑर्डर 1173: Picked up वापस लिया गया।'],
    'kitchen.done': ['Order 1173 was served.', 'ऑर्डर 1173 परोस दिया गया।'],
    'kitchen.undo': ['Order 1173: Served was undone.', 'ऑर्डर 1173: Served वापस लिया गया।'],
    'kitchen.rating': ['Order 1173: a customer rated your food. Butter Naan, 5 stars.', 'ऑर्डर 1173: ग्राहक ने आपके खाने को रेटिंग दी। Butter Naan, 5 स्टार।'],
    'kitchen.leave': ['Your leave was approved.', 'आपकी छुट्टी मंज़ूर हुई।'],
    'waiter.undo': ['Order 1173: Ready was undone.', 'ऑर्डर 1173: Ready वापस लिया गया।'],
    'waiter.leave': ['Your leave was approved.', 'आपकी छुट्टी मंज़ूर हुई।'],
};
const BY_ROLE = { admin: OWNER, rider: RIDER, kitchen: KITCHEN, waiter: WAITER };
// Every alert has four switches: n notification, s tone, v voice, p slider (the box that slides up over the app). The ones that need an answer
// keep their slider open until the person acts (sec 0); the rest close by themselves after `sec` seconds (the person can change it).
const SEC_CHOICES = [0, 3, 5, 7, 10, 15];
const STICKY = new Set(['admin.new_orders', 'admin.cancelled', 'admin.kitchen', 'admin.pickup', 'admin.help', 'admin.leave', 'rider.offers', 'kitchen.new']);
const TIMED = { 'kitchen.cancel': 8 };   // an alert that is only news: its slider closes by itself after this many seconds
for (const [role, list] of Object.entries(BY_ROLE)) {
    for (const x of list) {
        const e = !x.sample && SAMPLES[`${role}.${x.id}`]; if (e) x.sample = { en: e[0], hi: e[1] };
        x.can.p = true; x.can.v = true;
        x.defaults.p = !x.quiet; x.defaults.v = !x.noVoice && !x.quiet;
        x.defaults.sec = STICKY.has(`${role}.${x.id}`) ? 0 : (TIMED[`${role}.${x.id}`] || 5);
    }
}
const groupsFor = (role) => BY_ROLE[role] || [];
const groupOf = (role, type) => (type ? groupsFor(role).find((x) => x.types.includes(String(type))) || null : null);

// the person's choice for one group, with the recommended value where he has not chosen
const prefOf = (prefs, group) => {
    const own = (prefs && prefs[group.id]) || {};
    const out = {};
    for (const k of ['n', 'p', 's', 'v']) out[k] = group.can[k] ? (typeof own[k] === 'boolean' ? own[k] : group.defaults[k]) : (k === 'n' ? true : group.defaults[k]);
    out.sec = SEC_CHOICES.includes(own.sec) ? own.sec : group.defaults.sec;
    return out;
};

// keep only real, different-from-recommended choices of real groups
function cleanPrefs(role, body) {
    const out = {};
    for (const grp of groupsFor(role)) {
        const b = body && body[grp.id];
        if (!b || typeof b !== 'object') continue;
        const row = {};
        for (const k of ['n', 'p', 's', 'v']) if (grp.can[k] && typeof b[k] === 'boolean' && b[k] !== grp.defaults[k]) row[k] = b[k];
        if (SEC_CHOICES.includes(b.sec) && b.sec !== grp.defaults.sec) row.sec = b.sec;
        if (Object.keys(row).length) out[grp.id] = row;
    }
    return out;
}

// {offer} is the time the owner gave riders to take an offer (his Riders setting), said in words
const words = (secs) => { const n = Math.max(5, Math.round(Number(secs) || 120)); return n % 60 === 0 ? { en: `${n / 60} minute${n === 60 ? '' : 's'}`, hi: `${n / 60} मिनट` } : { en: `${n} seconds`, hi: `${n} सेकंड` }; };
const view = (role, prefs, ctx = {}) => groupsFor(role).map((g0) => {
    const w = words(ctx.offerSeconds);
    const x = { ...g0, hint: String(g0.hint).replace('{offer}', w.en), sample: g0.sample ? { en: String(g0.sample.en).replace('{offer}', w.en), hi: String(g0.sample.hi).replace('{offerHi}', w.hi) } : g0.sample };
    return viewRow(x, prefs);
});
const viewRow = (x, prefs) => ({ id: x.id, label: x.label, hint: x.hint, can: x.can, soft: x.soft, critical: x.critical, types: x.types, kinds: x.kinds, sample: x.sample, defaults: x.defaults, pref: prefOf(prefs, x) });

module.exports = { groupsFor, groupOf, prefOf, cleanPrefs, view };
