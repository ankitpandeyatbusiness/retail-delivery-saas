// ONE place that says WHO is told about WHAT and HOW. Change a line here to change the behaviour,
// or override it live from the database (NotificationRule) without a deploy.
//
//   to                   owner | customer | rider | superadmin  (who normally gets it)
//   channels             inapp (live message / inbox), push, sms. center.js tries them in this order.
//   alsoPush             send the push even when he is online
//   escalateSmsAfterSec  send the SMS if he still has not read it after this many seconds
//   key                  true (or a function of the message) = important enough for a paid SMS
//   email                a mail from templates/email (queued whatever happened with the channels above)
//   adminAlert           ALSO tell the superadmin, with this admin_ alert (whatever the owner's own rule says)
//   critical             (admin alerts) may go to the superadmin's phone as SMS when he switched that on
// The id of the owner app's loud new-order channel. Android freezes a channel's sound and vibration when it is first
// created on a phone, so a changed sound needs a NEW id (and the app creates it under the same name: mobile push.js).
const NEW_ORDER_CHANNEL = 'new_orders_v2';
// every push to a cook or a waiter rings on this channel: the "ting-tong" clip, so their phones never fall back to a random device tone.
// Built into the app (mobile/src/utils/common/push.js and app.config.js sounds).
const STAFF_CHANNEL = 'staff_alerts_v1';
// a quiet message for a cook or a waiter ("order handed over"): one soft ping instead of the ting-tong
const STAFF_INFO_CHANNEL = 'staff_info_v1';
// an inquiry from a customer rings with its own tone (the "cust_offer" clip built into the app), so the owner knows it without looking
const INQUIRY_CHANNEL = 'inquiry_v1';
// the two alarms: a cancelled order (a short falling "da-da-dum") and a rider's call for help (a gentle "pee-poo"). Built into the app like the others.
const CANCEL_CHANNEL = 'cancel_alert_v2';   // the owner's, the cook's and the waiter's cancelled-order alarm
const HELP_CHANNEL = 'help_alarm_v2';       // the owner's: a rider pressed the help button
const INAPP_PUSH = ['inapp', 'push'];
const ALL = ['inapp', 'push', 'sms'];
const KEY_CUSTOMER_STATUSES = ['accepted', 'out_for_delivery', 'delivered', 'cancelled'];

const EVENTS = {
    // owner
    // pushChannel / pushSound: the owner app's loud channel (a voice clip "New order received"). Both names are built into the app.
    order_new: { to: 'owner', channels: ALL, alsoPush: true, escalateSmsAfterSec: 180, key: true, pushChannel: NEW_ORDER_CHANNEL, pushSound: 'new_order' },
    order_unaccepted_reminder: { to: 'owner', channels: ALL, alsoPush: true, key: true, pushChannel: NEW_ORDER_CHANNEL, pushSound: 'new_order' },
    order_delivered_shop: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the food reached the customer
    order_cancelled: { to: 'owner', channels: INAPP_PUSH, alsoPush: true, pushChannel: CANCEL_CHANNEL, pushSound: 'cancel_alert' },
    order_late: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    rider_accepted: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    points_arrived: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // loyalty points reached the customer
    rider_badge: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },        // the rider moved up a badge
    booking_new: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },             // a guest booked a table
    booking_cancelled: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },       // a guest cancelled a booking
    booking_reminder: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },          // half an hour before a booked table
    booking_reminder_customer: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },
    booking_paid: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },         // the guest's deposit arrived: his table is booked, his receipt is ready
    booking_waitlist_free: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // a table came free in a slot the guest was waiting for
    booking_allowed: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },      // the shop confirmed a guest's table
    booking_owner_cancelled: { to: 'customer', channels: INAPP_PUSH, alsoPush: true }, // the shop cancelled a guest's booking
    inquiry_unanswered: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },      // a customer's message has waited a day for an answer
    inquiry_new: { to: 'owner', channels: INAPP_PUSH, alsoPush: true, pushChannel: INQUIRY_CHANNEL, pushSound: 'cust_offer' },             // a customer sent an inquiry from a service form
    inquiry_customer_reply: { to: 'owner', channels: INAPP_PUSH, alsoPush: true, pushChannel: INQUIRY_CHANNEL, pushSound: 'cust_offer' },  // a customer wrote again on an inquiry
    inquiry_reply: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },        // the shop answered an inquiry
    table_share_ask: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a guest asks to pay his share and leave
    table_share_paid: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },    // a friend at the same bill paid his share and left
    table_share_left: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },    // a friend left without paying: what is left on your bill
    table_guest_alert: { to: 'owner', channels: ['inapp'], alsoPush: false, noPush: true },       // QUIET: a guest who owes is not reachable, or has his location off (no push, no sound)
    table_join_request: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // a guest at a shared table asks to join your bill
    table_joined: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },        // the newcomer typed the right PIN: the guests on the bill are told who joined
    table_join_answer: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },    // the answer to that
    staff_leave_request: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a cook or a waiter asks for leave: the owner decides
    staff_leave_decision: { to: 'rider', channels: INAPP_PUSH, alsoPush: true, voice: true, pushChannel: STAFF_INFO_CHANNEL, pushSound: 'notify' },  // the owner said yes or no to their leave
    staff_holiday: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },         // a cook or a waiter put days off in their calendar
    staff_leave_withdrawn: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a cook or a waiter took their own leave or day off back
    staff_leave_removed: { to: 'rider', channels: INAPP_PUSH, alsoPush: true, voice: true, pushChannel: STAFF_INFO_CHANNEL, pushSound: 'notify' },   // the owner took a leave or a day off away from a cook or a waiter: they are told
    staff_on_duty: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },         // a cook, a waiter or a rider came on duty (the slider and the voice, like going off duty)
    staff_off_duty: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a cook or a waiter switched themselves off duty (no popup)
    pickup_intent: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a pickup customer says he is coming, is here, is late or needs more time
    pickup_waiting: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // a pickup order is ready and waiting
    pickup_time_request: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the customer asks to move his pickup to a later time: the owner answers
    pickup_time_ok: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },     // the shop agreed to the new pickup time
    pickup_time_no: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },     // the shop could not change it: the old time stays
    pickup_collect_claim: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },       // at his pickup time the customer says he collected it: the owner confirms (and says if he paid)
    pickup_not_wanted_claim: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the customer does not want his pickup any more: the owner chooses the refund
    pickup_thanks: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },          // thank you for collecting
    pickup_claim_no: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },        // the shop could not find it collected yet
    food_packed_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },        // the kitchen packed the order the rider is coming for
    order_shop_note: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },      // the shop writes to the customer about his order (a polite note)
    order_undone: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },             // someone took their last step back (Ready, Served, Picked up...): the owner knows
    kitchen_problem: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },          // the cook cannot make something (a dish is finished, or another problem)
    order_cancel_request: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },      // a table guest asks the shop to cancel a round
    order_cancel_no: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },        // the shop could not cancel it
    pickup_no_show: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },     // the customer did not come after his pickup time
    table_bill_asked: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a customer at a table asked for the bill
    table_paid_claim: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a customer who left unpaid says he paid: the owner must confirm
    owed_cleared: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },    // his unpaid bill is settled
    owed_claim_rejected: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // the shop could not find his payment
    owed_reminder: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // the shop reminds him of the bill he left unpaid
    referral_reward: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // a friend he referred had a first meal: points for him
    table_call: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },         // a guest calls the waiter / asks for water...
    table_feedback_low: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a guest was not happy (private)
    table_nudge: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a customer at a table asks the kitchen to hurry
    table_check: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // people finished eating and nobody asked for the bill
    table_walkout: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // he left without paying
    refund_processed: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // the refund of an online payment went through
    table_closed_owner: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a table's bill is fully paid and the table is free again
    table_bill_ready: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // the table visit is over: the guest who started the bill can download the detailed bill (PDF)
    table_freed: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },     // everyone on a paid bill: the table was released (by a guest, or by itself after 15 minutes)
    table_paid: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },      // the table bill was paid
    rider_leave_request: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a rider asked for leave
    rider_leave_withdrawn: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a rider took his own leave back
    rider_leave_removed: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },     // the owner took a rider's leave away
    rider_ended_duty: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a rider ended his duty by hand
    rider_leave_decision: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },  // the owner approved or rejected it
    rider_duty_auto: { to: 'rider', channels: ['inapp'] },                        // his schedule put him on or off duty
    rider_arrived_shop: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the rider tapped "I have arrived" at the customer
    rider_rejected: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    rider_none: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // nobody took the order: live AND push
    rider_problem: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    delivery_late_warning: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },          // same warning, for the shop
    rider_quiet: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the rider's phone has not reported for 3 minutes while he has an order
    review_food: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a customer reviewed the food of a delivered order (any rating)
    review_delivery: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },    // a customer reviewed the delivery (any rating)
    delivery_low_rating: { to: 'owner', channels: INAPP_PUSH },
    dish_low_rating: { to: 'owner', channels: INAPP_PUSH },
    complaint_new: { to: 'owner', channels: INAPP_PUSH },
    complaint_reminder: { to: 'owner', channels: INAPP_PUSH },
    bill_issued: { to: 'owner', channels: ALL, key: true, email: 'rent_invoice', adminAlert: 'admin_bill_issued' },
    bill_reminder: { to: 'owner', channels: INAPP_PUSH, email: 'bill_reminder', adminAlert: 'admin_grace_ending' },
    shop_paused: { to: 'owner', channels: ALL, key: true, email: 'shop_paused', adminAlert: 'admin_shop_paused' },
    bill_overdue: { to: 'owner', channels: ALL, key: true, email: 'bill_overdue' },   // every few days while a bill is overdue (SMS only when the app cannot be reached)
    shop_unpaused: { to: 'owner', channels: INAPP_PUSH, email: 'shop_unpaused', adminAlert: 'admin_shop_unpaused' },
    payment_received: { to: 'owner', channels: INAPP_PUSH, email: 'payment_receipt', adminAlert: 'admin_bill_paid' },
    monthly_report: { to: 'owner', channels: INAPP_PUSH, email: 'monthly_report' },   // the shop's progress report, once a month
    free_ending: { to: 'owner', channels: INAPP_PUSH, email: 'free_ending', adminAlert: 'admin_free_ending' },
    sms_topup_done: { to: 'owner', channels: INAPP_PUSH, email: 'sms_topup_receipt', adminAlert: 'admin_sms_topup_done' },
    sms_low: { to: 'owner', channels: INAPP_PUSH, adminAlert: 'admin_sms_low' },
    sms_zero: { to: 'owner', channels: INAPP_PUSH, adminAlert: 'admin_sms_zero' },
    platform_message: { to: 'owner', channels: INAPP_PUSH },
    owner_email_changed: { to: 'owner', channels: ['inapp'], email: 'owner_email_changed' },   // the mail goes to the OLD address (emailTo)
    owner_daily_summary: { to: 'owner', channels: INAPP_PUSH },   // Autopilot: how today went
    owner_weekly_digest: { to: 'owner', channels: INAPP_PUSH },   // Autopilot: how last week went
    shop_nudge: { to: 'customer', channels: INAPP_PUSH },         // a shop's reminder to a customer (Remind / Autopilot). Never SMS, never email
    broadcast: { to: 'customer', channels: INAPP_PUSH, email: 'broadcast' },                  // never SMS. The mail is queued only when the sender asked for it (ctx.noEmail)
    // customer (an SMS only for the important steps, and never for riders)
    order_status: { to: 'customer', channels: ALL, alsoPush: true, key: (ctx) => KEY_CUSTOMER_STATUSES.includes(ctx.data?.status) },
    rider_assigned: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },
    rider_arriving: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // live tracking: 3 minutes away (once per order)
    rider_reached: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },    // live tracking: at the door (once per order)
    complaint_decision: { to: 'customer', channels: INAPP_PUSH, email: 'complaint_decision' },
    // rider (offers last 2 minutes, so never an SMS)
    rider_offer: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },
    food_rating_cook: { to: 'rider', channels: INAPP_PUSH, alsoPush: true, voice: true, pushChannel: STAFF_INFO_CHANNEL, pushSound: 'notify' },   // the cook who started an order hears the customer's rating of the food
    table_paid_online: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },       // a guest paid his table bill from his phone: which table and how much
    table_paid_owner: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },        // a waiter took a table's money: which table, how much, who
    table_bill_waiting: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },      // the guests asked for the bill 5 minutes ago and nobody came
    table_ready_unserved: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },    // a dish has been ready for 5 minutes and nobody served it
    delivery_pin_skipped: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a rider delivered without the PIN: the owner reads why
    rider_assigned_owner: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // the owner picked this rider by hand: an order, not an offer
    delivery_late_warning_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // the order will be cancelled in ~10 minutes (services/lateDelivery.js)
    delivery_done_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // thank you to the rider who delivered
    review_delivery_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // the customer reviewed HIS delivery. The food review never goes to the rider
    rider_removed: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },
    rider_off_duty: { to: 'rider', channels: INAPP_PUSH },   // the app put him off duty (shop closed, or a very long duty)
    rider_sos: { to: 'owner', channels: ALL, key: true, alsoPush: true, pushChannel: HELP_CHANNEL, pushSound: 'help_alarm' },   // the rider pressed the help button: push AND, if the phone is unreachable, SMS
    // superadmin (his own keys, so an owner rule never changes them). SMS only if he switched it on.
    admin_bill_issued: { to: 'superadmin', channels: ALL },
    admin_bill_paid: { to: 'superadmin', channels: ALL },
    admin_shop_paused: { to: 'superadmin', channels: ALL, critical: true },
    admin_shop_unpaused: { to: 'superadmin', channels: ALL },
    admin_grace_ending: { to: 'superadmin', channels: ALL },
    admin_free_ending: { to: 'superadmin', channels: ALL },
    admin_free_ended: { to: 'superadmin', channels: ALL },
    admin_sms_low: { to: 'superadmin', channels: ALL },
    admin_sms_zero: { to: 'superadmin', channels: ALL },
    admin_sms_topup_done: { to: 'superadmin', channels: ALL },
    admin_shop_first_order: { to: 'superadmin', channels: ALL },
    admin_shop_inactive: { to: 'superadmin', channels: ALL },
    admin_webhook_failed: { to: 'superadmin', channels: ALL, critical: true },
    admin_sms_provider_failing: { to: 'superadmin', channels: ALL, critical: true },
    admin_refund_failed: { to: 'superadmin', channels: ALL, critical: true },
    admin_settlement_due: { to: 'superadmin', channels: INAPP_PUSH },   // a shop paid: what the partner owes the supreme admin (supreme admin only)
    admin_support_new: { to: 'superadmin', channels: ALL },
    admin_support_reply: { to: 'superadmin', channels: ALL },
};

// a type that is not listed above still works: inbox, live and push
const DEFAULT_EVENT = { to: 'owner', channels: INAPP_PUSH };

module.exports = { EVENTS, DEFAULT_EVENT, KEY_CUSTOMER_STATUSES, NEW_ORDER_CHANNEL, STAFF_CHANNEL, STAFF_INFO_CHANNEL, CANCEL_CHANNEL, HELP_CHANNEL };