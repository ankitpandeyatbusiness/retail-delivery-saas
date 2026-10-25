// What the owner's (and the staff's) Soundbox says in HINDI for the news alerts: one plain sentence each, made from the same values as the English text.
// An alert with no line here is read in English (with the English voice), never in Hindi with English words. Dish names and people's names stay as they are.
const range = (v) => (v.from === v.to ? v.from : `${v.from} से ${v.to}`);
const days = (v) => (v.days ? `, ${v.days} ${v.days === 1 ? 'दिन' : 'दिन'}` : '');
const job = (v) => (v.job === 'Kitchen' ? 'कुक' : v.job === 'Waiter' ? 'वेटर' : v.job || 'स्टाफ');
const rs = (n) => `${Math.round(Number(n) || 0)} रुपये`;

const PROBLEM = { cannot_reach: 'ग्राहक तक पहुँच नहीं पा रहे', customer_not_answering: 'ग्राहक फ़ोन नहीं उठा रहे', wrong_address: 'कहते हैं कि पता गलत लग रहा है' };

const HI = {
    rider_problem: (v) => `डिलीवरी में समस्या। ${v.riderName || 'राइडर'} ${PROBLEM[v.reason] || 'ने समस्या बताई है'}। ऑर्डर ${v.orderNo}।${v.note ? ` नोट: ${v.note}` : ''}`,
    rider_leave_request: (v) => `राइडर ${v.riderName || ''} ने छुट्टी मांगी है। ${range(v)}, ${v.days} दिन।${v.reason ? ` कारण: ${v.reason}` : ''}`,
    staff_leave_request: (v) => `${v.name || 'आपके स्टाफ'} (${job(v)}) ने छुट्टी मांगी है। ${range(v)}${days(v)}। कारण: ${v.reason || ''}`,
    staff_leave_withdrawn: (v) => `${v.name || 'आपके स्टाफ'} (${job(v)}) ने ${v.what === 'a day off' ? 'अपनी छुट्टी का दिन' : 'अपनी छुट्टी'} वापस ले ली। ${range(v)}${days(v)}। ${v.wasApproved ? 'यह मंज़ूर थी।' : 'यह अभी तय नहीं हुई थी।'} अब वे उन दिनों ड्यूटी पर हैं।`,
    staff_holiday: (v) => `${v.name || 'आपके स्टाफ'} (${job(v)}) ${range(v)} को छुट्टी पर रहेंगे।${v.note ? ` ${v.note}` : ''}`,
    staff_off_duty: (v) => `${v.name || 'आपके स्टाफ'} (${job(v)}) ड्यूटी से बाहर हो गए हैं।`,
    staff_leave_decision: (v) => `${v.approved ? 'आपकी छुट्टी मंज़ूर हो गई है।' : 'आपकी छुट्टी मंज़ूर नहीं हुई।'} ${range(v)}।${v.note ? ` दुकान की ओर से: ${v.note}` : ''}`,
    staff_leave_removed: (v) => `मालिक ने आपकी ${range(v)} की छुट्टी हटा दी है। उन दिनों आप ड्यूटी पर हैं।${v.note ? ` मालिक कहते हैं: ${v.note}` : ''}`,
    // what a rider hears (his Soundbox in Hindi)
    rider_offer: (v) => `नई डिलीवरी रिक्वेस्ट। ${v.brief || `ऑर्डर ${v.orderNo}`}।${v.area ? ` ${v.area}।` : ''}${v.collect ? ` ${rs(v.collect)} लेने हैं।` : ''} ${v.secs} सेकंड में स्वीकार करें।${v.note ? ` ग्राहक कहते हैं: ${v.note}` : ''}`,
    rider_assigned_owner: (v) => `मालिक ने आपको ऑर्डर ${v.orderNo} दिया है।${v.brief ? ` ${v.brief}।` : ''} इसे ${v.address || 'ग्राहक'} तक पहुँचाइए।${v.note ? ` ग्राहक कहते हैं: ${v.note}` : ''}`,
    delivery_done_rider: (v) => `ऑर्डर ${v.orderNo} पूरा हुआ। बहुत बढ़िया काम, धन्यवाद!`,
    review_delivery_rider: (v) => `आपकी डिलीवरी पर नया रिव्यू आया है।${v.orderNo ? ` ऑर्डर ${v.orderNo}।` : ''}`,
    rider_badge: () => 'आपको नया बैज मिला है। ग्राहक और दुकान इसे देख सकते हैं। बढ़िया काम जारी रखिए।',
    rider_off_duty: () => 'आप ड्यूटी से बाहर हैं। ड्यूटी शुरू करने तक नए ऑर्डर नहीं मिलेंगे।',
    rider_duty_auto: (v) => (v.on ? 'आपकी ड्यूटी का समय शुरू हो गया है। अब नए ऑर्डर आपको मिल सकते हैं।' : v.why === 'leave' ? 'आज आप छुट्टी पर हैं, इसलिए आपको ड्यूटी से बाहर कर दिया गया।' : 'आपकी ड्यूटी का समय खत्म हो गया। फिर मिलेंगे।'),
    rider_leave_removed: (v) => `मालिक ने आपकी ${range(v)} की छुट्टी हटा दी है। उन दिनों आप ड्यूटी पर हैं।${v.note ? ` मालिक कहते हैं: ${v.note}` : ''}`,
    rider_leave_withdrawn: (v) => `${v.riderName || 'राइडर'} ने अपनी ${range(v)} की छुट्टी वापस ले ली है।`,
    rider_ended_duty: (v) => `${v.riderName || 'राइडर'} ने ड्यूटी खत्म कर दी है।${v.until ? ` ${v.until} पर वापस आएँगे।` : ''}`,
    rider_leave_decision: (v) => `${v.approved ? 'आपकी छुट्टी मंज़ूर हो गई।' : 'आपकी छुट्टी मंज़ूर नहीं हुई।'} ${range(v)}।${v.note ? ` दुकान की ओर से: ${v.note}` : ''}`,
    rider_removed: (v) => `ऑर्डर ${v.orderNo} किसी और डिलीवरी पार्टनर को दे दिया गया। आपको कुछ करने की ज़रूरत नहीं।`,
    order_cancelled: (v) => (v.audience === 'rider' ? (v.undelivered ? `ऑर्डर ${v.orderNo} डिलीवर नहीं हुआ मार्क किया गया।` : `ऑर्डर ${v.orderNo} रद्द हो गया${v.lateDelivery ? ', क्योंकि वह एक घंटे से ज़्यादा लेट था' : ''}।`) : ''),
    order_undone: (v) => `ऑर्डर ${v.orderNo}: ${v.by || 'किसी ने'} ने "${v.step}" वापस लिया।`,
    rider_accepted: (v) => `राइडर ${v.riderName || ''} ने ऑर्डर ${v.orderNo} स्वीकार किया।`,
    rider_rejected: (v) => `राइडर ${v.riderName || ''} ने ऑर्डर ${v.orderNo ?? ''} मना कर दिया।`,
    rider_none: (v) => `ऑर्डर ${v.orderNo} के लिए कोई राइडर नहीं मिला। कृपया हाथ से राइडर चुनें।`,
    rider_arrived_shop: (v) => `${v.riderName || 'डिलीवरी पार्टनर'} ऑर्डर ${v.orderNo} के लिए ग्राहक के पास पहुँच गए।`,
    delivery_late_warning: (v) => `ऑर्डर ${v.orderNo} ${v.late} मिनट लेट है। ${v.left} मिनट में डिलीवर न हुआ तो रद्द होकर पूरा पैसा लौट जाएगा।`,
    delivery_late_warning_rider: (v) => `ऑर्डर ${v.orderNo} ${v.late} मिनट लेट है। अभी डिलीवर कीजिए। ${v.left} मिनट में रद्द हो जाएगा।`,
    order_delivered_shop: (v) => `ऑर्डर ${v.orderNo} ग्राहक तक पहुँच गया।`,
    food_packed_rider: (v) => `ऑर्डर ${v.orderNo} पैक हो गया है। आकर ले जाइए।`,
    complaint_new: (v) => `ऑर्डर ${v.orderNo ?? ''} पर नई शिकायत आई है।`,
    complaint_reminder: (v) => `ऑर्डर ${v.orderNo ?? ''} की शिकायत का 24 घंटे से जवाब नहीं गया। कृपया जवाब दीजिए।`,
    review_food: (v) => `ऑर्डर ${v.orderNo ?? ''} के खाने पर नया रिव्यू आया है।`,
    review_delivery: (v) => `ऑर्डर ${v.orderNo ?? ''} की डिलीवरी पर नया रिव्यू आया है।`,
    dish_low_rating: () => 'एक डिश को कम रेटिंग मिली है।',
    delivery_low_rating: () => 'एक डिलीवरी को कम रेटिंग मिली है।',
    table_share_ask: (v) => `${v.name || 'एक मेहमान'} अपना हिस्सा देकर जाना चाहते हैं। टेबल ${v.table}।`,
    table_paid_claim: (v) => `${v.name || 'एक ग्राहक'} कहते हैं कि उन्होंने ${rs(v.amount)} दे दिए हैं। कृपया जाँचकर पक्का करें।`,
    order_cancel_request: (v) => `${v.where || 'टेबल'}: ऑर्डर ${v.orderNo} रद्द करने की गुज़ारिश आई है।`,
    table_feedback_low: (v) => `टेबल ${v.table} खुश नहीं थे।`,
    table_nudge: (v) => `टेबल ${v.table} इंतज़ार कर रही है। कृपया खाना जल्दी लाइए।`,
    table_check: (v) => `टेबल ${v.table}: ${rs(v.due)} लेने हैं। उन्होंने खा लिया है, बिल किसी ने नहीं मांगा। टेबल देख लीजिए।`,
    pickup_no_show: (v) => `ऑर्डर ${v.orderNo} लेने कोई नहीं आया। पिकअप का समय खत्म हो गया।`,
    pickup_time_request: (v) => `ऑर्डर ${v.orderNo}: ग्राहक पिकअप का समय बदलना चाहते हैं।`,
    pickup_collect_claim: (v) => `ऑर्डर ${v.orderNo}: ग्राहक कहते हैं कि उन्होंने ले लिया। कृपया पक्का करें।`,
    pickup_not_wanted_claim: (v) => `ऑर्डर ${v.orderNo}: ग्राहक को अब खाना नहीं चाहिए। रिफंड तय कीजिए।`,
    table_bill_asked: (v) => `टेबल ${v.table} ने बिल मांगा है।`,
    table_call: (v) => `टेबल ${v.table} बुला रही है।`,
    bill_issued: () => 'आपका मासिक बिल तैयार है।',
    bill_reminder: () => 'आपका मासिक बिल अभी बाकी है।',
    bill_overdue: () => 'आपका मासिक बिल देर से बाकी है। कृपया जल्दी भर दीजिए।',
    shop_paused: () => 'बिल न भरने से आपकी दुकान रोक दी गई है।',
    shop_unpaused: () => 'आपकी दुकान फिर से चालू हो गई है।',
    payment_received: () => 'आपका भुगतान मिल गया। धन्यवाद।',
    sms_low: () => 'आपका SMS बैलेंस कम है। कृपया रिचार्ज कीजिए।',
    sms_zero: () => 'आपका SMS बैलेंस खत्म हो गया है। कृपया रिचार्ज कीजिए।',
    sms_topup_done: () => 'आपका SMS रिचार्ज हो गया है।',
    free_ending: () => 'आपकी मुफ़्त अवधि जल्द खत्म हो रही है।',
    platform_message: () => 'प्लेटफ़ॉर्म की ओर से आपके लिए एक संदेश है।',
    owner_daily_summary: () => 'आज का सारांश तैयार है।',
    owner_weekly_digest: () => 'पिछले हफ़्ते का सारांश तैयार है।',
    monthly_report: () => 'इस महीने की रिपोर्ट तैयार है।',
};

// -> the Hindi sentence, or null when this alert has none (it is then read in English)
function build(eventKey, vars = {}) {
    try {
        const f = HI[eventKey];
        return f ? String(f(vars || {})).replace(/\s+/g, ' ').trim() : null;
    } catch (e) { return null; }
}

module.exports = { build, HI };
