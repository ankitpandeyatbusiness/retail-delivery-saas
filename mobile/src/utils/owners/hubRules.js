// Small pure helpers for the Shop hub screens (customers, complaints, reviews, messages, coupons, banners).

export const COMPLAINT_TYPES = {
    missing_item: 'Item missing', wrong_item: 'Wrong item', quality: 'Food quality', late: 'Late delivery', packaging: 'Packaging', other: 'Other',
};
export const COMPLAINT_STATUS = { open: 'New', in_progress: 'In progress', resolved: 'Decided' };
export const RESOLUTION_TEXT = { none: 'Replied', refund_full: 'Full refund', refund_partial: 'Part refund', no_refund: 'No refund' };

export const MESSAGE_STATUS = { queued: 'Waiting', sending: 'Sending', done: 'Sent', failed: 'Failed', finished: 'Sent' };
export const AUDIENCES = [['customers', 'Customers'], ['riders', 'Riders'], ['both', 'Both']];

// "Aarav Shah" / "98xxxxx210" -> what to show for a customer
export const personName = (u) => u?.name || (u?.phone ? `Customer ${String(u.phone).slice(-4)}` : 'Customer');

// 0..5 stars as text: 4 -> "★★★★☆"
export const starText = (n) => '★'.repeat(Math.max(0, Math.min(5, Math.round(n)))) + '☆'.repeat(5 - Math.max(0, Math.min(5, Math.round(n))));

// coupon -> "20% off up to ₹100" / "₹50 off"
export function couponText(c) {
    const off = c.discountType === 'percent' ? `${c.discountValue}% off${c.maxDiscount ? ` up to ₹${c.maxDiscount}` : ''}` : `₹${c.discountValue} off`;
    return `${off}${c.minOrder ? ` on ₹${c.minOrder}+` : ''}`;
}

// first problem with a coupon form, or null
export function couponProblem(v) {
    if (!/^[A-Za-z0-9]{3,20}$/.test(v.code.trim())) return 'The code is 3 to 20 letters or digits, without spaces';
    if (!(v.discountValue > 0)) return 'Enter the discount';
    if (v.discountType === 'percent' && v.discountValue > 100) return 'A percent coupon cannot be more than 100';
    if (v.startsAt && !/^\d{4}-\d{2}-\d{2}$/.test(v.startsAt)) return 'Type the start date as 2026-11-01';
    if (v.endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(v.endsAt)) return 'Type the end date as 2026-11-01';
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) return 'The end date cannot be before the start date';
    return null;
}
