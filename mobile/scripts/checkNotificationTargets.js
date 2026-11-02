// Run:  node scripts/checkNotificationTargets.js      (from the mobile folder)
// Checks where tapping each kind of notification leads, for the owner, the customer, the cook and the rider.
// A line that says "nothing" is meant to be information only. Anything that should open a screen and does not is a failure.
const path = require('path');
const babel = require(path.join(__dirname, '../node_modules/@babel/core'));
const fs = require('fs');
const Module = require('module');

function load(file) {
    const full = path.join(__dirname, '../src', file);
    const { code } = babel.transformSync(fs.readFileSync(full, 'utf8'), { filename: full, configFile: path.join(__dirname, '../babel.config.js') });
    const m = new Module(full, module); m.filename = full; m.paths = Module._nodeModulePaths(path.dirname(full));
    const real = m.require.bind(m);
    m.require = (p) => (p.startsWith('.') ? real(path.resolve(path.dirname(full), p) + (p.endsWith('.js') ? '' : '.js')) : real(p));
    m._compile(code.replace(/require\((['"])(\.[^'"]+)\1\)/g, (x, q, p) => `require(${q}${p}${q})`), full);
    return m.exports;
}
// the owner's route file has no imports; the target file imports it
const owner = load('utils/owners/notificationRoute.js');
const targetSrcPath = path.join(__dirname, '../src/utils/common/notificationTarget.js');
const tcode = babel.transformSync(fs.readFileSync(targetSrcPath, 'utf8'), { filename: targetSrcPath, configFile: path.join(__dirname, '../babel.config.js') }).code;
const tm = new Module(targetSrcPath, module);
tm.require = (p) => (p.includes('notificationRoute') ? owner : require(p));
tm._compile(tcode, targetSrcPath);
const { notificationTarget, bulkStale } = tm.exports;

const ID = '65f000000000000000000001';
// [role, type, data, expected screen name or null]
const cases = [
    // the owner
    ['admin', 'order_new', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'order_cancelled', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'order_late', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'pickup_time_request', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'pickup_collect_claim', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'pickup_no_show', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'pickup_intent', { orderId: ID, kind: 'pickup' }, 'OwnerOrder'],
    ['admin', 'delivery_pin_skipped', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'delivery_late_warning', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'rider_arrived_shop', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'rider_quiet', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'rider_problem', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'rider_none', { orderId: ID, kind: 'rider' }, 'OwnerOrder'],
    ['admin', 'order_undone', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'kitchen_problem', { orderId: ID }, 'OwnerOrder'],
    ['admin', 'order_cancel_request', { orderId: ID, tableNo: '3' }, 'OwnerOrder'],
    ['admin', 'review_food', { orderId: ID }, 'OwnerReviews'],
    ['admin', 'review_delivery', { orderId: ID }, 'OwnerReviews'],
    ['admin', 'dish_low_rating', { orderId: ID }, 'OwnerReviews'],
    ['admin', 'delivery_low_rating', { orderId: ID }, 'OwnerReviews'],
    ['admin', 'complaint_new', { orderId: ID, complaintId: ID }, 'OwnerComplaint'],
    ['admin', 'complaint_reminder', { complaintId: ID }, 'OwnerComplaint'],
    ['admin', 'bulk_new', { bulkId: ID, kind: 'bulk' }, 'OwnerBulkOrder'],
    ['admin', 'bulk_paid', { bulkId: ID, kind: 'bulk' }, 'OwnerBulkOrder'],
    ['admin', 'bulk_cancelled', { bulkId: ID, kind: 'bulk' }, 'OwnerBulkOrder'],
    ['admin', 'inquiry_new', { inquiryId: ID, kind: 'inquiry' }, 'OwnerInquiry'],
    ['admin', 'booking_new', { bookingId: ID, kind: 'booking' }, 'OwnerBookings'],
    ['admin', 'booking_reminder', {}, 'OwnerBookings'],
    ['admin', 'table_bill_asked', { sessionId: ID, kind: 'table' }, 'OwnerDineIn'],
    ['admin', 'table_call', { kind: 'table_call' }, 'OwnerDineIn'],
    ['admin', 'table_paid_online', { sessionId: ID, kind: 'table_paid_online' }, 'OwnerDineIn'],
    ['admin', 'table_paid_claim', { kind: 'owed_claim' }, 'OwnerDineIn'],
    ['admin', 'table_ready_unserved', { orderId: ID, kind: 'table', tableNo: '2' }, 'OwnerDineIn'],
    ['admin', 'table_feedback_low', { kind: 'table_feedback' }, 'OwnerDineIn'],
    ['admin', 'staff_leave_request', { userId: ID, leaveId: ID, kind: 'staff_leave' }, 'OwnerStaffPerson'],
    ['admin', 'staff_on_duty', { userId: ID, kind: 'staff_on_duty' }, 'OwnerStaffPerson'],
    ['admin', 'staff_on_duty', { riderId: ID, userId: ID, kind: 'staff_on_duty' }, 'OwnerRider'],
    ['admin', 'rider_ended_duty', { riderId: ID, userId: ID, kind: 'rider_duty' }, 'OwnerRider'],
    ['admin', 'rider_leave_request', { riderId: ID, leaveId: ID, kind: 'rider_leave' }, 'OwnerRider'],
    ['admin', 'rider_sos', { riderId: ID, kind: 'sos' }, 'OwnerRider'],
    ['admin', 'bill_issued', {}, 'OwnerRent'],
    ['admin', 'bill_overdue', {}, 'OwnerRent'],
    ['admin', 'sms_low', {}, 'OwnerSms'],
    ['admin', 'monthly_report', { period: '2026-10', kind: 'business_report' }, 'OwnerBusiness'],
    ['admin', 'owner_daily_summary', {}, 'OwnerBusiness'],
    ['admin', 'owner_weekly_digest', {}, 'OwnerBusiness'],
    ['admin', 'automation_done', {}, 'OwnerAutomations'],
    ['admin', 'platform_message', {}, null],
    ['admin', 'owner_email_changed', {}, null],
    // the customer
    ['customer', 'order_status', { orderId: ID }, 'OrderDetail'],
    ['customer', 'rider_assigned', { orderId: ID }, 'OrderDetail'],
    ['customer', 'rider_arriving', { orderId: ID, kind: 'tracking' }, 'OrderDetail'],
    ['customer', 'rider_reached', { orderId: ID, kind: 'tracking' }, 'OrderDetail'],
    ['customer', 'pickup_waiting', { orderId: ID }, 'OrderDetail'],
    ['customer', 'refund_processed', { orderId: ID }, 'OrderDetail'],
    ['customer', 'complaint_decision', { orderId: ID, complaintId: ID }, 'OrderDetail'],
    ['customer', 'bulk_quoted', { bulkId: ID, kind: 'bulk' }, 'BulkOrderDetail'],
    ['customer', 'bulk_confirmed', { bulkId: ID, kind: 'bulk' }, 'BulkOrderDetail'],
    ['customer', 'bulk_stage', { bulkId: ID, kind: 'bulk' }, 'BulkOrderDetail'],
    ['customer', 'bulk_completed', { bulkId: ID, kind: 'bulk' }, 'BulkOrderDetail'],
    ['customer', 'bulk_refund', { bulkId: ID, kind: 'bulk' }, 'BulkOrderDetail'],
    ['customer', 'bulk_shop_cancelled', { bulkId: ID, kind: 'bulk' }, 'BulkOrderDetail'],
    ['customer', 'inquiry_reply', { inquiryId: ID, kind: 'inquiry' }, 'Inquiry'],
    ['customer', 'booking_allowed', { bookingId: ID, kind: 'booking' }, 'MyBookings'],
    ['customer', 'booking_paid', { bookingId: ID, kind: 'booking' }, 'MyBookings'],
    ['customer', 'booking_reminder_customer', {}, 'MyBookings'],
    ['customer', 'booking_waitlist_free', { kind: 'booking_waitlist' }, 'MyBookings'],
    ['customer', 'points_arrived', { kind: 'points' }, 'MyPoints'],
    ['customer', 'referral_reward', { kind: 'referral' }, 'MyPoints'],
    ['customer', 'table_bill_ready', { sessionId: ID, kind: 'table_bill' }, 'TableBill'],
    ['customer', 'table_join_request', { sessionId: ID, kind: 'table_join' }, 'TableBill'],
    ['customer', 'table_share_paid', { sessionId: ID, kind: 'table' }, 'TableBill'],
    ['customer', 'table_paid', { sessionId: ID, kind: 'table_paid' }, 'TableBill'],
    ['customer', 'shop_nudge', { kind: 'nudge' }, null],
    ['customer', 'broadcast', { kind: 'broadcast' }, null],
    // the rider
    ['rider', 'rider_offer', { orderId: ID }, 'RiderTrip'],
    ['rider', 'rider_assigned_owner', { orderId: ID }, 'RiderTrip'],
    ['rider', 'food_packed_rider', { orderId: ID }, 'RiderTrip'],
    ['rider', 'rider_removed', { orderId: ID }, 'RiderTrip'],
    ['rider', 'rider_leave_decision', { leaveId: ID, kind: 'rider_leave' }, 'StaffLeave'],
    ['rider', 'rider_badge', { kind: 'badge' }, 'RiderPoints'],
    ['rider', 'rider_duty_auto', { kind: 'duty_auto' }, 'StaffLeave'],
    // the cook and the waiter
    ['kitchen', 'staff_leave_decision', { leaveId: ID, kind: 'staff_leave' }, 'StaffLeave'],
    ['kitchen', 'kitchen_new', { orderId: ID }, null],
    ['waiter', 'staff_leave_removed', { leaveId: ID, kind: 'staff_leave' }, 'StaffLeave'],
];

let bad = 0;
for (const [role, type, data, want] of cases) {
    const got = notificationTarget(role, { type, data });
    const name = got ? got.name : null;
    if (name !== want) { bad += 1; console.log(`WRONG  ${role.padEnd(9)} ${type.padEnd(28)} wanted ${want || 'nothing'}, got ${name || 'nothing'}`); }
}
// a bulk notification that has moved on is not shown as news again
const stale = [
    ['bulk_new', 'requested', null], ['bulk_new', 'quoted', 'already sent the quote'], ['bulk_new', 'confirmed', 'already confirmed'], ['bulk_new', 'cancelled', 'cancelled this bulk order'],
    ['bulk_new', 'declined', 'declined'], ['bulk_new', 'expired', 'ran out'], ['bulk_change', 'requested', null], ['bulk_change', 'quoted', 'already sent the quote'],
    ['bulk_paid', 'confirmed', null], ['bulk_paid', 'preparing', null], ['bulk_paid', 'cancelled', 'was cancelled'], ['bulk_cancelled', 'cancelled', null],
];
for (const [type, status, want] of stale) {
    const r = bulkStale(type, status, 'B7K2');
    const ok = want === null ? r === null : !!r && r.body.includes(want);
    if (!ok) { bad += 1; console.log(`WRONG  stale ${type} while ${status}: wanted ${want || 'still news'}, got ${r ? r.body : 'still news'}`); }
}
console.log(bad ? `${bad} wrong` : `all ${cases.length + stale.length} notification checks pass`);
process.exit(bad ? 1 : 0);
