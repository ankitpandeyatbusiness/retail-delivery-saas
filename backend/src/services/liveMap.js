// What the owner's live map shows, in one answer (GET /api/shop/live-map):
//   shop    the shop's own pin and name (the start of every delivery), or null when the shop has no pin on the map
//   riders  every active rider who is online or carrying an order, with his live position (memory, from the pings) when it is fresh:
//           { riderId, name, phone, isOnline, activeOrderCount, avgDeliveryMin, lat, lng, heading, at, quiet, orderIds }
//   trips   every delivery that is on the way (collected, not delivered):
//           { orderId, orderNo, riderId, riderName, customer: { name, phone }, address: { text, area }, dest: { lat, lng },
//             route: { polyline, source, distanceM, durationSec } | null, etaAt, remainingM, dueAt, late, collectedAt, total, collect }
// The road and the arrival time are the ones the server already keeps for the customer's tracking (services/tripEta.js): nothing new
// is asked from Google. A rider with no fresh position has lat / lng null and quiet true.
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const User = require('../models/User');
const liveTracking = require('./liveTracking');
const tripEta = require('./tripEta');
const deliveryPlan = require('./deliveryPlan');

const QUIET_MS = 60000;   // no position for this long: his phone has gone quiet

const addressText = (a = {}) => [a.line1, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');
const areaText = (a = {}) => [a.landmark, a.city].filter(Boolean).join(', ') || a.pincode || '';

async function build(tenant, now = Date.now()) {
    const tenantId = tenant._id;
    const [riderRows, orders] = await Promise.all([
        Rider.find({ tenantId, isActive: true, $or: [{ isOnline: true }, { activeOrderCount: { $gt: 0 } }] })
            .select('userId name isOnline activeOrderCount deliveryCount deliverySecTotal').lean(),
        Order.find({ tenantId, orderType: 'delivery', status: 'out_for_delivery', 'delivery.status': 'picked_up' })
            .select('orderNo customer address pricing payment delivery.riderId delivery.dueAt delivery.pickedUpAt').lean(),
    ]);
    const users = await User.find({ _id: { $in: riderRows.map((r) => r.userId) } }).select('phone').lean();
    const phoneOf = new Map(users.map((u) => [String(u._id), u.phone || null]));
    const nameOf = new Map(riderRows.map((r) => [String(r.userId), r.name || null]));

    const trips = orders.map((o) => {
        const v = tripEta.view(o._id);
        const a = o.address || {};
        const cod = o.payment?.method === 'cod' && o.payment?.status !== 'paid';
        const dueAt = o.delivery?.dueAt || null;
        const hasPin = Number.isFinite(a.latitude) && Number.isFinite(a.longitude);
        return {
            orderId: String(o._id), orderNo: o.orderNo, riderId: String(o.delivery.riderId), riderName: nameOf.get(String(o.delivery.riderId)) || null,
            customer: { name: o.customer?.name || null, phone: o.customer?.phone || null },
            address: { text: addressText(a), area: areaText(a) },
            dest: hasPin ? { lat: a.latitude, lng: a.longitude } : null,
            route: v?.route || null,
            etaAt: v?.eta?.etaAt || null, remainingM: v?.eta?.remainingM ?? null,
            dueAt, late: !!dueAt && now > new Date(dueAt).getTime(),
            collectedAt: o.delivery?.pickedUpAt || null,
            total: o.pricing?.total ?? null, collect: cod ? (o.pricing?.total ?? 0) : 0,
        };
    });
    const byRider = new Map();
    for (const t of trips) byRider.set(t.riderId, [...(byRider.get(t.riderId) || []), t.orderId]);

    const riders = riderRows.map((r) => {
        const p = liveTracking.latestFor(r.userId);   // null when older than a few minutes
        const at = p?.at ? new Date(p.at).getTime() : null;
        return {
            riderId: String(r.userId), name: r.name || null, phone: phoneOf.get(String(r.userId)) || null,
            isOnline: !!r.isOnline, activeOrderCount: r.activeOrderCount || 0, avgDeliveryMin: deliveryPlan.avgMin(r),
            lat: p ? p.lat : null, lng: p ? p.lng : null, heading: p?.heading ?? null, at: p?.at || null,
            quiet: !p || (at != null && now - at > QUIET_MS),
            orderIds: byRider.get(String(r.userId)) || [],
        };
    });

    const d = tenant.delivery || {};
    const shop = Number.isFinite(d.latitude) && Number.isFinite(d.longitude) ? { lat: d.latitude, lng: d.longitude, name: tenant.name || null } : null;
    return { shop, riders, trips };
}

module.exports = { build, QUIET_MS };
