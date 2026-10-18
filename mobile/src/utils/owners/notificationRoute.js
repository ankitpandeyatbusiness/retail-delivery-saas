// Where tapping an owner notification should lead, or null when it is only information (then it is not tappable).
// Used by the inbox list AND by a tapped push, so both always agree.
//   n: { type, data }   (data as the server sends it: ids are text)
const ORDER = new Set([
    'order_new', 'order_cancelled', 'order_late', 'order_unaccepted_reminder',
    'rider_accepted', 'rider_rejected', 'rider_none', 'rider_problem',
]);
const BILL = new Set(['bill_issued', 'bill_reminder', 'payment_received', 'shop_paused', 'shop_unpaused', 'free_ending']);
const SMS = new Set(['sms_low', 'sms_zero', 'sms_topup_done']);

export function ownerRoute(n) {
    const type = n?.type;
    const d = n?.data || {};
    if (d.kind === 'support' && d.ticketId) return { name: 'OwnerSupportTicket', params: { id: String(d.ticketId) } };
    if (d.kind === 'fee_plan') return { name: 'OwnerRent' };
    if (d.kind === 'closing_report') return { name: 'OwnerClosing' };
    if (d.kind === 'business_report') return { name: 'OwnerBusiness', params: d.period ? { range: String(d.period) } : undefined };
    if (ORDER.has(type) && d.orderId) return { name: 'OwnerOrder', params: { id: String(d.orderId) } };
    if ((type === 'complaint_new' || type === 'complaint_reminder') && d.complaintId) return { name: 'OwnerComplaint', params: { id: String(d.complaintId) } };
    if (type === 'rider_sos' && d.riderId) return { name: 'OwnerRider', params: { userId: String(d.riderId) } };
    if (BILL.has(type)) return { name: 'OwnerRent' };
    if (SMS.has(type)) return { name: 'OwnerSms' };
    if (type === 'dish_low_rating' || type === 'delivery_low_rating') return { name: 'OwnerReviews' };
    if (d.disputeId) return { name: 'OwnerPayments' };
    return null;   // an announcement, an email-changed notice...: nothing to open
}
