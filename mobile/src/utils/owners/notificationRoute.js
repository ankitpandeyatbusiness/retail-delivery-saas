// Where tapping an owner notification should lead, or null when it is only information (then it is not tappable).
// Used by the inbox list AND by a tapped push, so both always agree.
//   n: { type, data }   (data as the server sends it: ids are text)
const ORDER = new Set([
    'order_new', 'order_cancelled', 'order_late', 'order_unaccepted_reminder', 'order_delivered_shop',
    'rider_accepted', 'rider_rejected', 'rider_none', 'rider_problem', 'kitchen_problem', 'pickup_intent',
]);
const BILL = new Set(['bill_issued', 'bill_reminder', 'bill_overdue', 'payment_received', 'shop_paused', 'shop_unpaused', 'free_ending']);
const REVIEWS = new Set(['dish_low_rating', 'delivery_low_rating', 'review_food', 'review_delivery']);
const isTable = (type, d) => /^table_/.test(String(type || '')) || ['table', 'table_call', 'table_feedback', 'table_paid', 'table_paid_online', 'table_paid_owner', 'table_freed', 'owed_claim'].includes(d.kind);
const SMS = new Set(['sms_low', 'sms_zero', 'sms_topup_done']);

export function ownerRoute(n) {
    const type = n?.type;
    const d = n?.data || {};
    if (d.kind === 'support' && d.ticketId) return { name: 'OwnerSupportTicket', params: { id: String(d.ticketId) } };
    // a leave, a day off, or going off duty: the person's own page (their leaves and days off, with the buttons to take them away)
    if (['staff_leave', 'staff_holiday', 'staff_off_duty'].includes(d.kind)) return d.userId ? { name: 'OwnerStaffPerson', params: { userId: String(d.userId) } } : { name: 'OwnerStaff' };
    if (d.kind === 'rider_leave' && d.riderId) return { name: 'OwnerRider', params: { userId: String(d.riderId) } };
    if (d.kind === 'booking' || type === 'booking_reminder') return { name: 'OwnerBookings' };
    // a cook, a waiter or a rider came on duty: their page
    if (d.kind === 'staff_on_duty' || d.kind === 'rider_duty') return d.riderId ? { name: 'OwnerRider', params: { userId: String(d.riderId) } } : d.userId ? { name: 'OwnerStaffPerson', params: { userId: String(d.userId) } } : { name: 'OwnerStaff' };
    if (REVIEWS.has(type)) return { name: 'OwnerReviews' };
    if (d.kind === 'bulk' && d.bulkId) return { name: 'OwnerBulkOrder', params: { id: String(d.bulkId) } };
    if (d.kind === 'inquiry' && d.inquiryId) return { name: 'OwnerInquiry', params: { id: String(d.inquiryId) } };
    if (d.kind === 'fee_plan' || d.kind === 'rent') return { name: 'OwnerPlan' };
    if (d.kind === 'closing_report') return { name: 'OwnerClosing' };
    if (d.kind === 'business_report') return { name: 'OwnerBusiness', params: d.period ? { range: String(d.period) } : undefined };
    if ((type === 'complaint_new' || type === 'complaint_reminder') && d.complaintId) return { name: 'OwnerComplaint', params: { id: String(d.complaintId) } };
    // anything about one order (a pickup customer's request, a rider's problem, a late delivery, a PIN skipped...) opens that order
    if (d.orderId && (ORDER.has(type) || !isTable(type, d))) return { name: 'OwnerOrder', params: { id: String(d.orderId) } };
    if (isTable(type, d)) return { name: 'OwnerDineIn' };   // a table: the guests, the bill, a call
    if (type === 'rider_sos' && d.riderId) return { name: 'OwnerRider', params: { userId: String(d.riderId) } };
    if (BILL.has(type)) return { name: 'OwnerPlan' };
    if (SMS.has(type)) return { name: 'OwnerSms' };
    if (type === 'owner_daily_summary') return { name: 'OwnerBusiness', params: { range: '1' } };
    if (type === 'owner_weekly_digest') return { name: 'OwnerBusiness', params: { range: '7' } };
    if (type === 'automation_done' || type === 'automation_remind') return { name: 'OwnerAutomations' };
    if (d.disputeId) return { name: 'OwnerPayments' };
    return null;   // an announcement, an email-changed notice...: nothing to open
}
