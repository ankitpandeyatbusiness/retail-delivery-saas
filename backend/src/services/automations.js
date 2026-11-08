// Automations: what the shop would otherwise have to do by hand to keep things moving, done by the system once the owner's time has passed.
// Each rule has its own setting (0 / false = the owner does it himself) in ShopAutomation; a shop that never opened the screen has the recommended values.
// Every automatic ACTION tells the owner afterwards ("automation_done"); a REMINDER is only a nudge ("automation_remind"), the decision stays his.
// Rules never touch what the owner already dealt with: each one re-reads the order, booking or inquiry and changes it with a filtered update.
//   runAll(now)   one pass of every rule (the job calls it every minute)
const Order = require('../models/Order');
const Tenant = require('../models/Tenant');
const TableBooking = require('../models/TableBooking');
const TableSession = require('../models/TableSession');
const ServiceInquiry = require('../models/ServiceInquiry');
const Complaint = require('../models/Complaint');
const StaffLeave = require('../models/StaffLeave');
const RiderLeave = require('../models/RiderLeave');
const Rider = require('../models/Rider');
const ShopAutomation = require('../models/ShopAutomation');
const AutomationNote = require('../models/AutomationNote');
const { httpError } = require('../middlewares/apiErrors');
const { HIDE_UNPAID } = require('./onlineOrder');

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

// the recommended values: on where a missed task would stall the shop for no good reason, off where it is the owner's decision
const DEFAULTS = {
    reservationAutoAllowMin: 30, reservationNoShowMin: 30, depositAutoAdjust: true, pickupNotCollectedMin: 60, cancelRequestDeclineMin: 5, inquiryCloseDays: 7,
    stageAlerts: true, cashLimitReminders: true, leaveReminders: true, kitchenProblemReminders: true, complaintReminders: true, closedDayReminders: true, autoApproveLeave: false,
};
const CHOICES = {
    reservationAutoAllowMin: [0, 15, 30, 60], reservationNoShowMin: [0, 15, 30, 45, 60], pickupNotCollectedMin: [0, 30, 60, 120],
    cancelRequestDeclineMin: [0, 3, 5, 10], inquiryCloseDays: [0, 3, 7, 14],
};
const FLAGS = ['depositAutoAdjust', 'stageAlerts', 'cashLimitReminders', 'leaveReminders', 'kitchenProblemReminders', 'complaintReminders', 'closedDayReminders', 'autoApproveLeave'];

async function get(tenantId) {
    const row = await ShopAutomation.findOne({ tenantId }).lean();
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (row && row[k] !== undefined && row[k] !== null) out[k] = row[k];
    return out;
}

// only the fields sent change; every number must be one of the choices on the screen
async function save(tenantId, body = {}) {
    const set = {};
    for (const [k, list] of Object.entries(CHOICES)) {
        if (body[k] === undefined) continue;
        if (!list.includes(Number(body[k]))) throw httpError(400, `Choose one of ${list.join(', ')} for this automation`);
        set[k] = Number(body[k]);
    }
    for (const k of FLAGS) if (body[k] !== undefined) set[k] = !!body[k];
    if (Object.keys(set).length) await ShopAutomation.updateOne({ tenantId }, { $set: set }, { upsert: true });
    return get(tenantId);
}
const reset = async (tenantId) => { await ShopAutomation.deleteOne({ tenantId }); return get(tenantId); };

// tell the owner what was done (or what is waiting). text in English, textHi for the Hindi voice.
async function tell(tenantId, kind, text, textHi, data = {}) {
    try {
        return await require('../notifications/center').notify(kind, { tenantId, vars: { text, textHi: textHi || '' }, data: { kind: 'automation', ...data } });
    } catch (e) { console.error('Automation notice error:', e.message); return null; }
}

// "may this reminder go now?": at most one in `everyMs`, and at most `max` of them in all. Claimed with one filtered update, so two servers never both send.
async function claim(tenantId, key, everyMs, max, now) {
    const cutoff = new Date(now - everyMs);
    const hit = await AutomationNote.findOneAndUpdate({ tenantId, key, at: { $lte: cutoff }, ...(max ? { n: { $lt: max } } : {}) }, { $set: { at: new Date(now) }, $inc: { n: 1 } }, { new: true });
    if (hit) return true;
    try { await AutomationNote.create({ tenantId, key, at: new Date(now), n: 1 }); return true; } catch (e) { return false; }   // the row exists and it is not time yet
}

const makeCfgOf = () => { const cache = new Map(); return async (tid) => { const k = String(tid); if (!cache.has(k)) cache.set(k, await get(tid)); return cache.get(k); }; };
const shopNames = async (ids) => new Map((await Tenant.find({ _id: { $in: ids } }).select('name').lean()).map((t) => [String(t._id), t.name]));

/* ------------------------------ actions ------------------------------ */

// a pickup order ready and waiting, the customer never came: marked not collected (the customer is at fault), like the owner's own tap
async function pickupNotCollected(now, cfgOf) {
    const svc = require('./orderService');
    const orders = await Order.find({ orderType: 'pickup', status: 'ready', pickupUntil: { $ne: null, $lte: new Date(now - 30 * MIN) }, ...HIDE_UNPAID }).select('_id tenantId orderNo pickupUntil').limit(200).lean();
    let n = 0;
    for (const o of orders) {
        const cfg = await cfgOf(o.tenantId);
        if (!cfg.pickupNotCollectedMin) continue;
        if (now < new Date(o.pickupUntil).getTime() + Math.max(30, cfg.pickupNotCollectedMin) * MIN) continue;
        try {
            await svc.updateStatusByShop({ tenantId: o.tenantId, actor: { type: 'owner', id: null, label: 'Automation' }, orderId: o._id, status: 'undelivered', reasonCode: 'customer', note: 'The customer did not collect it (marked automatically)' });
            n += 1;
            await tell(o.tenantId, 'automation_done', `Pickup order #${o.orderNo} was marked not collected, as the customer did not come.`, `पिकअप ऑर्डर ${o.orderNo} को नहीं लिया गया मार्क किया गया, क्योंकि ग्राहक नहीं आया।`, { orderId: String(o._id), orderNo: o.orderNo });
        } catch (e) { if (![400, 404, 409].includes(e.status)) console.error('Automation pickup:', e.message); }
    }
    return n;
}

// a paid reservation nobody answered
async function reservationAutoAllow(now, cfgOf) {
    const bp = require('./bookingPayment');
    const rows = await TableBooking.find({ status: 'confirmed', approvedAt: { $exists: false }, 'deposit.status': 'paid', 'payment.paidAt': { $lte: new Date(now - 15 * MIN) }, endsAt: { $gt: new Date(now) } }).limit(200).lean();
    if (!rows.length) return 0;
    const names = await shopNames([...new Set(rows.map((b) => b.tenantId))]);
    let n = 0;
    for (const b of rows) {
        const cfg = await cfgOf(b.tenantId);
        if (!cfg.reservationAutoAllowMin || now - new Date(b.payment.paidAt).getTime() < cfg.reservationAutoAllowMin * MIN) continue;
        try {
            const done = await bp.allow({ _id: b._id, shopName: names.get(String(b.tenantId)) || '' });
            if (done) { n += 1; await tell(b.tenantId, 'automation_done', `${b.name}'s reservation (${b.party} guests, ${b.date} ${b.time}) was allowed automatically.`, `${b.name} का रिज़र्वेशन अपने आप मंज़ूर किया गया।`, { bookingId: String(b._id) }); }
        } catch (e) { console.error('Automation allow:', e.message); }
    }
    return n;
}

// a reservation whose time came and went. If the guest is dining at that table (nobody pressed Seated), he is marked SEATED, never no-show: his deposit is safe.
async function reservationNoShow(now, cfgOf) {
    const bp = require('./bookingPayment');
    const rows = await TableBooking.find({ status: 'confirmed', approvedAt: { $exists: true }, startsAt: { $lte: new Date(now - 15 * MIN) } }).limit(200);
    let n = 0;
    for (const b of rows) {
        const cfg = await cfgOf(b.tenantId);
        if (!cfg.reservationNoShowMin || now < b.startsAt.getTime() + cfg.reservationNoShowMin * MIN) continue;
        try {
            const dining = b.table ? await TableSession.findOne({ tenantId: b.tenantId, table: b.table, createdAt: { $gte: new Date(b.startsAt.getTime() - 30 * MIN) } }).select('_id').lean() : null;
            if (dining) {
                const done = await TableBooking.findOneAndUpdate({ _id: b._id, status: 'confirmed' }, { $set: { status: 'seated', arrivedAt: new Date(now), arrivedBy: { type: 'system' } } }, { new: true });
                if (done) { await bp.seated(done); n += 1; await tell(b.tenantId, 'automation_done', `Table ${b.table}: ${b.name} was already eating, so the reservation was marked seated.`, `टेबल ${b.table}: ${b.name} खा रहे थे, इसलिए रिज़र्वेशन बैठा हुआ मार्क किया गया।`, { bookingId: String(b._id) }); }
            } else {
                const done = await TableBooking.findOneAndUpdate({ _id: b._id, status: 'confirmed' }, { $set: { status: 'no_show' } }, { new: true });
                if (done) { await bp.noShow(done); n += 1; await tell(b.tenantId, 'automation_done', `${b.name}'s reservation (${b.date} ${b.time}) was marked no-show, as the guest did not come.`, `${b.name} का रिज़र्वेशन नहीं आया मार्क किया गया।`, { bookingId: String(b._id) }); }
            }
        } catch (e) { console.error('Automation no-show:', e.message); }
    }
    return n;
}

// the guest's table bill is closed: the deposit counts as taken off it
async function depositAdjust(now, cfgOf) {
    const bp = require('./bookingPayment');
    const rows = await TableBooking.find({ status: 'seated', 'deposit.status': 'paid', 'deposit.credit': 'pending' }).limit(200);
    let n = 0;
    for (const b of rows) {
        const cfg = await cfgOf(b.tenantId);
        if (!cfg.depositAutoAdjust || !b.table) continue;
        const since = b.arrivedAt || b.startsAt;
        const closed = await TableSession.findOne({ tenantId: b.tenantId, table: b.table, status: 'closed', closedAt: { $gte: since } }).select('_id').lean();
        if (!closed) continue;
        try {
            const r = await bp.adjusted(b);
            if (r.modifiedCount) { n += 1; await tell(b.tenantId, 'automation_done', `The ₹${b.deposit.amount} deposit of ${b.name} was marked taken off the table bill.`, `${b.name} की ₹${b.deposit.amount} जमा राशि बिल से कटी मार्क की गई।`, { bookingId: String(b._id) }); }
        } catch (e) { console.error('Automation adjust:', e.message); }
    }
    return n;
}

// a table guest asked to cancel a dish that is already being made: declined with a clear reason (a dish not started yet is left to the owner)
async function declineCancelRequests(now, cfgOf) {
    const center = require('../notifications/center');
    const rows = await Order.find({ orderType: 'dine_in', 'cancelRequest.at': { $lte: new Date(now - 3 * MIN) }, status: { $in: ['preparing', 'ready'] } }).select('_id tenantId userId orderNo cancelRequest').limit(200).lean();
    let n = 0;
    for (const o of rows) {
        const cfg = await cfgOf(o.tenantId);
        if (!cfg.cancelRequestDeclineMin || now - new Date(o.cancelRequest.at).getTime() < cfg.cancelRequestDeclineMin * MIN) continue;
        const r = await Order.updateOne({ _id: o._id, 'cancelRequest.at': { $exists: true } }, { $unset: { cancelRequest: 1 } });
        if (!r.modifiedCount) continue;
        n += 1;
        center.notify('order_cancel_no', { tenantId: o.tenantId, userId: o.userId, vars: { orderNo: o.orderNo, message: 'It is already being made, so it cannot be cancelled now.' }, data: { orderId: String(o._id), orderNo: o.orderNo } });
        await tell(o.tenantId, 'automation_done', `A request to cancel order #${o.orderNo} was declined, as the dish was already being made.`, `ऑर्डर ${o.orderNo} रद्द करने की मांग मना कर दी गई, क्योंकि डिश बन रही थी।`, { orderId: String(o._id) });
    }
    return n;
}

// an inquiry that was answered and then went quiet: ended (the guest can start a new one)
async function closeQuietInquiries(now, cfgOf) {
    const realtime = require('./realtime');
    const rows = await ServiceInquiry.find({ status: { $in: ['replied', 'quoted', 'confirmed', 'rejected'] }, lastMessageAt: { $lte: new Date(now - 3 * DAY) } }).select('_id tenantId userId status lastMessageAt serviceName').limit(400).lean();
    const per = new Map();
    const shopNames = new Map();
    for (const i of rows) {
        const cfg = await cfgOf(i.tenantId);
        if (!cfg.inquiryCloseDays || now - new Date(i.lastMessageAt).getTime() < cfg.inquiryCloseDays * DAY) continue;
        const r = await ServiceInquiry.updateOne({ _id: i._id, status: i.status }, { $set: { status: 'closed' } });
        if (!r.modifiedCount) continue;
        per.set(String(i.tenantId), (per.get(String(i.tenantId)) || 0) + 1);
        realtime.toUser(i.tenantId, i.userId, 'notification', { id: `ac${i._id}`, type: 'inquiry_changed', title: null, body: null, data: { kind: 'inquiry', inquiryId: String(i._id) } });
        // and he is told in words, the same message as when the owner ends the conversation himself (a push and the inbox)
        const shop = shopNames.get(String(i.tenantId)) ?? (await require('../models/Tenant').findById(i.tenantId).select('name').lean())?.name;
        shopNames.set(String(i.tenantId), shop);
        require('../notifications/center').notify('inquiry_ended', { tenantId: i.tenantId, userId: i.userId, vars: { shop: shop || 'The shop', service: i.serviceName }, data: { kind: 'inquiry', inquiryId: String(i._id) } }).catch((e) => console.error('Notification error:', e.message));
    }
    for (const [tid, c] of per) await tell(tid, 'automation_done', `${c} quiet inquir${c === 1 ? 'y was' : 'ies were'} ended automatically.`, `${c} शांत पूछताछ अपने आप बंद की गई।`);
    return [...per.values()].reduce((a, b) => a + b, 0);
}

/* ------------------------------ reminders: only a nudge, the decision stays with the owner ------------------------------ */

async function stageAlerts(now, cfgOf) {
    let n = 0;
    const slow = await Order.find({ status: 'preparing', updatedAt: { $lte: new Date(now - 60 * MIN) }, ...HIDE_UNPAID }).select('_id tenantId orderNo').limit(200).lean();
    const noRider = await Order.find({ status: 'ready', orderType: 'delivery', 'delivery.riderId': { $exists: false }, updatedAt: { $lte: new Date(now - 10 * MIN) }, ...HIDE_UNPAID }).select('_id tenantId orderNo').limit(200).lean();
    for (const [rows, what, hi] of [[slow, 'has been cooking for over an hour', 'एक घंटे से ज़्यादा से बन रहा है'], [noRider, 'is ready and has no delivery partner yet', 'तैयार है और अभी तक कोई राइडर नहीं मिला']]) {
        for (const o of rows) {
            if (!(await cfgOf(o.tenantId)).stageAlerts) continue;
            if (!(await claim(o.tenantId, `stage:${o._id}:${what.slice(0, 5)}`, 15 * MIN, 6, now))) continue;
            n += 1; await tell(o.tenantId, 'automation_remind', `Order #${o.orderNo} ${what}.`, `ऑर्डर ${o.orderNo} ${hi}।`, { orderId: String(o._id) });
        }
    }
    return n;
}

async function cashLimitReminders(now, cfgOf) {
    const cod = require('./codService');
    const shops = await Tenant.find({ 'settings.riders.cashLimit': { $gt: 0 } }).select('_id settings.riders.cashLimit').limit(500).lean();
    let n = 0;
    for (const t of shops) {
        if (!(await cfgOf(t._id)).cashLimitReminders) continue;
        const over = await cod.overLimitIds(t._id, Math.round(t.settings.riders.cashLimit * 100));
        for (const id of over) {
            if (!(await claim(t._id, `cash:${id}`, 3 * HOUR, 8, now))) continue;
            const r = await Rider.findOne({ tenantId: t._id, userId: id }).select('name').lean();
            n += 1; await tell(t._id, 'automation_remind', `${r?.name || 'A rider'} holds more cash than your limit and gets no new orders. Record the handover when you have the money.`, `${r?.name || 'एक राइडर'} के पास सीमा से ज़्यादा कैश है, इसलिए उसे नए ऑर्डर नहीं मिलते। पैसे मिलने पर हैंडओवर दर्ज करें।`, { riderId: String(id) });
        }
    }
    return n;
}

// a leave request nobody answered: reminded, and (only if the owner chose it) approved after 2 hours
async function leaves(now, cfgOf) {
    const staffLeave = require('./staffLeave');
    let n = 0;
    const old = new Date(now - 2 * HOUR);
    const rows = [...(await StaffLeave.find({ status: 'pending', createdAt: { $lte: old } }).limit(200).lean()).map((l) => ({ l, kind: 'staff' })),
        ...(await RiderLeave.find({ status: 'pending', createdAt: { $lte: old } }).limit(200).lean()).map((l) => ({ l, kind: 'rider' }))];
    for (const { l, kind } of rows) {
        const cfg = await cfgOf(l.tenantId);
        if (kind === 'staff' && cfg.autoApproveLeave) {
            try { await staffLeave.decide({ tenantId: l.tenantId, id: l._id, approve: true, note: 'Approved automatically' }); n += 1; await tell(l.tenantId, 'automation_done', 'A leave request nobody answered for 2 hours was approved automatically.', 'जिस छुट्टी की मांग का 2 घंटे जवाब नहीं आया, वह अपने आप मंज़ूर हुई।', { leaveId: String(l._id) }); continue; } catch (e) { /* decided meanwhile */ }
        }
        if (!cfg.leaveReminders) continue;
        if (!(await claim(l.tenantId, `leave:${l._id}`, 4 * HOUR, 3, now))) continue;
        n += 1; await tell(l.tenantId, 'automation_remind', `A ${kind === 'rider' ? 'rider' : 'staff'} leave request is waiting for your answer.`, `${kind === 'rider' ? 'राइडर' : 'स्टाफ'} की छुट्टी की मांग आपके जवाब का इंतज़ार कर रही है।`, { leaveId: String(l._id) });
    }
    return n;
}

async function kitchenProblems(now, cfgOf) {
    const rows = await Order.find({ 'kitchen.problem.kind': { $exists: true }, 'kitchen.problem.handledAt': { $exists: false }, 'kitchen.problem.at': { $lte: new Date(now - 10 * MIN) }, status: { $nin: ['delivered', 'cancelled', 'undelivered'] } }).select('_id tenantId orderNo kitchen.problem').limit(200).lean();
    let n = 0;
    for (const o of rows) {
        if (!(await cfgOf(o.tenantId)).kitchenProblemReminders) continue;
        if (!(await claim(o.tenantId, `kp:${o._id}`, 10 * MIN, 6, now))) continue;
        n += 1; await tell(o.tenantId, 'automation_remind', `The kitchen reported a problem with order #${o.orderNo} and is waiting for your answer.`, `किचन ने ऑर्डर ${o.orderNo} में समस्या बताई है और आपके जवाब का इंतज़ार है।`, { orderId: String(o._id) });
    }
    return n;
}

// reservations that fall on a day the shop is closed (a holiday added later...): the owner is reminded once a day, and cancels and refunds them from Reservations
async function closedDayBookings(now, cfgOf) {
    const rows = await TableBooking.find({ status: 'confirmed', startsAt: { $gt: new Date(now) } }).select('tenantId date time').limit(1000).lean();
    const byShop = new Map();
    for (const b of rows) { const k = String(b.tenantId); if (!byShop.has(k)) byShop.set(k, []); byShop.get(k).push(b); }
    const tb = require('./tableBooking');
    let n = 0;
    for (const [tid, list] of byShop) {
        if (!(await cfgOf(tid)).closedDayReminders) continue;
        const config = await tb.getConfig(tid);
        const bad = list.filter((b) => tb.closedFor(config, b.date, b.time)).length;
        if (!bad) continue;
        if (!(await claim(tid, `closedday:${tid}`, 24 * HOUR, 5, now))) continue;
        n += 1; await tell(tid, 'automation_remind', `${bad} reservation${bad > 1 ? 's' : ''} fall${bad > 1 ? '' : 's'} on a day the shop is closed. Open Reservations to cancel and refund ${bad > 1 ? 'them' : 'it'}.`, `${bad} रिज़र्वेशन ऐसे दिन पर हैं जब दुकान बंद है। रिज़र्वेशन खोलकर रद्द करें और पैसे लौटाएँ।`, { kind: 'booking' });
    }
    return n;
}

async function complaints(now, cfgOf) {
    const rows = await Complaint.find({ status: 'open', remindedAt: { $ne: null, $lte: new Date(now - 24 * HOUR) } }).select('_id tenantId orderNo').limit(200).lean();
    let n = 0;
    for (const c of rows) {
        if (!(await cfgOf(c.tenantId)).complaintReminders) continue;
        if (!(await claim(c.tenantId, `complaint:${c._id}`, 24 * HOUR, 3, now))) continue;
        n += 1; await tell(c.tenantId, 'automation_remind', `The complaint on order #${c.orderNo} is still waiting for your answer.`, `ऑर्डर ${c.orderNo} की शिकायत अभी भी आपके जवाब का इंतज़ार कर रही है।`, { complaintId: String(c._id) });
    }
    return n;
}

const RULES = { pickupNotCollected, reservationAutoAllow, reservationNoShow, depositAdjust, declineCancelRequests, closeQuietInquiries, stageAlerts, cashLimitReminders, leaves, kitchenProblems, complaints, closedDayBookings };

async function runAll(now = Date.now()) {
    const cfgOf = makeCfgOf();
    const done = {};
    for (const [name, fn] of Object.entries(RULES)) {
        try { done[name] = await fn(now, cfgOf); } catch (e) { console.error(`Automation ${name} error:`, e.message); done[name] = 0; }
    }
    return done;
}

module.exports = { DEFAULTS, CHOICES, get, save, reset, claim, runAll, ...RULES };
