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
const INAPP_PUSH = ['inapp', 'push'];
const ALL = ['inapp', 'push', 'sms'];
const KEY_CUSTOMER_STATUSES = ['accepted', 'out_for_delivery', 'delivered', 'cancelled'];

const EVENTS = {
    // owner
    // pushChannel / pushSound: the owner app's loud channel (a voice clip "New order received"). Both names are built into the app.
    order_new: { to: 'owner', channels: ALL, alsoPush: true, escalateSmsAfterSec: 180, key: true, pushChannel: NEW_ORDER_CHANNEL, pushSound: 'new_order' },
    order_unaccepted_reminder: { to: 'owner', channels: ALL, alsoPush: true, key: true, pushChannel: NEW_ORDER_CHANNEL, pushSound: 'new_order' },
    order_delivered_shop: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the food reached the customer
    order_cancelled: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    order_late: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    rider_accepted: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },
    points_arrived: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // loyalty points reached the customer
    rider_badge: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },        // the rider moved up a badge
    pickup_waiting: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },   // a pickup order is ready and waiting
    pickup_time_changed: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // the customer moved his pickup time to a later one
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
    table_paid: { to: 'customer', channels: INAPP_PUSH, alsoPush: true },      // the table bill was paid
    rider_leave_request: { to: 'owner', channels: INAPP_PUSH, alsoPush: true },   // a rider asked for leave
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
    delivery_late_warning_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // the order will be cancelled in ~10 minutes (services/lateDelivery.js)
    delivery_done_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // thank you to the rider who delivered
    review_delivery_rider: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },   // the customer reviewed HIS delivery. The food review never goes to the rider
    rider_removed: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },
    rider_off_duty: { to: 'rider', channels: INAPP_PUSH },   // the app put him off duty (shop closed, or a very long duty)
    rider_sos: { to: 'owner', channels: ALL, key: true, alsoPush: true },   // the rider pressed the help button: push AND, if the phone is unreachable, SMS
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

module.exports = { EVENTS, DEFAULT_EVENT, KEY_CUSTOMER_STATUSES, NEW_ORDER_CHANNEL };