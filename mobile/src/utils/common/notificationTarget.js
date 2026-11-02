// Where tapping a notification leads, for every kind of person. ONE place, used by the inbox list and by a tapped push, so both always agree.
//   role: 'admin' (the owner) | 'customer' | 'rider' | 'kitchen' | 'waiter'      n: { type, data }   (data as the server sends it: ids are text)
// Returns { name, params } for a screen, or null when the message is only information (then the inbox row is not tappable).
// The owner's own rules live in utils/owners/notificationRoute.js.
import { ownerRoute } from '../owners/notificationRoute';

const LEAVE_KINDS = ['staff_leave', 'staff_holiday', 'rider_leave', 'duty_auto', 'off_duty'];

// Is a bulk notification still the latest word? (status = the bulk order's status NOW). null = yes, show it as usual.
// Otherwise { title, body }: it has moved on, and that is what the owner is shown instead of an old slider and an old voice.
export function bulkStale(type, status, code) {
    const title = `Bulk order ${code || ''}`.trim();
    if (['bulk_new', 'bulk_change'].includes(type)) {
        if (status === 'cancelled') return { title, body: 'The customer cancelled this bulk order. Nothing to do.' };
        if (status === 'declined') return { title, body: 'You declined this bulk order. Nothing to do.' };
        if (status === 'expired') return { title, body: 'The quote ran out. Nothing to do.' };
        if (status && status !== 'requested') return { title, body: status === 'quoted' ? 'You already sent the quote. Nothing to do.' : 'This bulk order is already confirmed. Nothing to do.' };
    }
    if (type === 'bulk_paid' && ['cancelled', 'declined'].includes(status)) return { title, body: 'This bulk order was cancelled.' };
    return null;
}

export function notificationTarget(role, n) {
    const type = String(n?.type || n?.data?.type || '');
    const d = n?.data || {};
    if ((role === 'admin' || role === 'customer') && d.kind === 'chat' && d.chatKind && d.refId) return { name: 'Chat', params: { kind: String(d.chatKind), refId: String(d.refId) } };   // a message in a chat
    if (role === 'admin') return ownerRoute({ type, data: d });

    if (role === 'customer') {
        if (d.kind === 'bulk' && d.bulkId) return { name: 'BulkOrderDetail', params: { id: String(d.bulkId) } };   // the shop's quote, its steps, the invoice
        if (d.kind === 'inquiry' && d.inquiryId) return { name: 'Inquiry', params: { id: String(d.inquiryId) } };
        if (d.kind === 'booking' || d.kind === 'booking_waitlist' || /^booking_/.test(type)) return { name: 'MyBookings' };   // the table he booked, and the code to show
        if (d.kind === 'points' || d.kind === 'referral' || type === 'points_arrived' || type === 'referral_reward') return { name: 'MyPoints' };
        if (d.orderId) return { name: 'OrderDetail', params: { id: String(d.orderId) } };
        // a table: the bill he shares or owes
        if (/^table_/.test(type) || ['table', 'table_bill', 'table_paid', 'table_join', 'table_freed'].includes(d.kind)) return { name: 'TableBill' };
        return null;   // a shop's message, a reminder to come back...: nothing to open
    }

    if (role === 'rider') {
        if (d.orderId) return { name: 'RiderTrip', params: { orderId: String(d.orderId) } };   // his own trip page (the customer's order page says "not found" to him)
        if (LEAVE_KINDS.includes(d.kind) || /_leave_/.test(type)) return { name: 'StaffLeave' };
        if (d.kind === 'badge' || type === 'rider_badge') return { name: 'RiderPoints' };
        return null;
    }

    // a cook or a waiter: their work screen is their home; only a leave answer has a page of its own
    if (role === 'kitchen' || role === 'waiter') {
        if (LEAVE_KINDS.includes(d.kind) || /_leave_/.test(type)) return { name: 'StaffLeave' };
        return null;
    }
    return null;
}
