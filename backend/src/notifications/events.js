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
const INAPP_PUSH = ['inapp', 'push'];
const ALL = ['inapp', 'push', 'sms'];
const KEY_CUSTOMER_STATUSES = ['accepted', 'out_for_delivery', 'delivered', 'cancelled'];

const EVENTS = {
    // owner
    order_new: { to: 'owner', channels: ALL, alsoPush: true, escalateSmsAfterSec: 180, key: true },
    order_unaccepted_reminder: { to: 'owner', channels: ALL, alsoPush: true, key: true },
    order_cancelled: { to: 'owner', channels: INAPP_PUSH },
    order_late: { to: 'owner', channels: INAPP_PUSH },
    rider_accepted: { to: 'owner', channels: INAPP_PUSH },
    rider_rejected: { to: 'owner', channels: INAPP_PUSH },
    rider_none: { to: 'owner', channels: INAPP_PUSH },
    rider_problem: { to: 'owner', channels: INAPP_PUSH },
    delivery_low_rating: { to: 'owner', channels: INAPP_PUSH },
    bill_issued: { to: 'owner', channels: ALL, key: true, email: 'rent_invoice', adminAlert: 'admin_bill_issued' },
    bill_reminder: { to: 'owner', channels: INAPP_PUSH, email: 'bill_reminder', adminAlert: 'admin_grace_ending' },
    shop_paused: { to: 'owner', channels: ALL, key: true, email: 'shop_paused', adminAlert: 'admin_shop_paused' },
    payment_received: { to: 'owner', channels: INAPP_PUSH, email: 'payment_receipt', adminAlert: 'admin_bill_paid' },
    free_ending: { to: 'owner', channels: INAPP_PUSH, email: 'free_ending', adminAlert: 'admin_free_ending' },
    sms_topup_done: { to: 'owner', channels: INAPP_PUSH, email: 'sms_topup_receipt', adminAlert: 'admin_sms_topup_done' },
    sms_low: { to: 'owner', channels: INAPP_PUSH, adminAlert: 'admin_sms_low' },
    sms_zero: { to: 'owner', channels: INAPP_PUSH, adminAlert: 'admin_sms_zero' },
    platform_message: { to: 'owner', channels: INAPP_PUSH },
    // customer (an SMS only for the important steps, and never for riders)
    order_status: { to: 'customer', channels: ALL, key: (ctx) => KEY_CUSTOMER_STATUSES.includes(ctx.data?.status) },
    rider_assigned: { to: 'customer', channels: INAPP_PUSH },
    // rider (offers last 2 minutes, so never an SMS)
    rider_offer: { to: 'rider', channels: INAPP_PUSH, alsoPush: true },
    rider_removed: { to: 'rider', channels: INAPP_PUSH },
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
};

// a type that is not listed above still works: inbox, live and push
const DEFAULT_EVENT = { to: 'owner', channels: INAPP_PUSH };

module.exports = { EVENTS, DEFAULT_EVENT, KEY_CUSTOMER_STATUSES };