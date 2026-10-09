// The ONE place where an order's status changes.
// Shop owner, customer, superadmin, rider (Phase 6) and timers all call change().
//
//   const orderStatus = require('./orderStatusService');
//   await orderStatus.change({
//       order,                                   // the Order document
//       status: 'accepted',
//       actor: { type: 'owner', id: userId, label: '9876543210' },
//       note: 'optional',
//       tenant,                                  // only needed for actor.type 'customer'
//   });
//
// actor.type is one of: customer, owner, rider, superadmin, system.

const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Rider = require('../models/Rider');
const CodSettlement = require('../models/CodSettlement');
const { nextStatuses, customerCanCancel, ACTIVE_STATUSES } = require('./orderflow');
const { httpError } = require('../middlewares/apiErrors');
const notify = require('./notificationService');

const CANCELLED_BY = { customer: 'customer', owner: 'shop', superadmin: 'admin', system: 'system' };
const ACTOR_TYPES = ['customer', 'owner', 'rider', 'superadmin', 'system'];

const cleanNote = (note) => (typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : undefined);

// Throws a clear error if this actor may not make this move
function checkAllowed({ order, status, actor, note, tenant }) {
    switch (actor.type) {
        case 'owner':
            if (!nextStatuses(order).includes(status)) {
                throw httpError(409, `This order is "${order.status}". It cannot move to "${status}".`);
            }
            if (status === 'cancelled' && !note) throw httpError(400, 'Please give a reason for cancelling');
            return;
        case 'customer':
            if (status !== 'cancelled') throw httpError(403, 'Customers can only cancel');
            if (!customerCanCancel(order, tenant)) {
                throw httpError(409, 'You can cancel only before the shop accepts your order (unless the shop is suspended)');
            }
            return;
        case 'superadmin':
            if (!ACTIVE_STATUSES.includes(order.status)) {
                throw httpError(409, `This order is already "${order.status}" and cannot be changed`);
            }
            // the owner's normal next step, or a force to cancelled / delivered
            if (!nextStatuses(order).includes(status) && !['cancelled', 'delivered'].includes(status)) {
                throw httpError(400, 'Superadmin can move an order one step forward, or force it to cancelled or delivered');
            }
            return;
        case 'system':
            if (status !== 'cancelled') throw httpError(403, 'The system can only cancel');
            if (!ACTIVE_STATUSES.includes(order.status)) throw httpError(409, 'This order is already finished');
            return;
        case 'rider': {
            // only the rider who accepted this delivery, and only pickup and delivered
            const d = order.delivery || {};
            if (order.orderType !== 'delivery' || !d.riderId || String(d.riderId) !== String(actor.id)
                || !['accepted', 'picked_up'].includes(d.status)) {
                throw httpError(403, 'This order is not assigned to you');
            }
            if (status === 'out_for_delivery') {
                if (d.status !== 'accepted' || !['preparing', 'ready'].includes(order.status)) {
                    throw httpError(409, 'The order is not ready for pickup yet');
                }
                return;
            }
            if (status === 'delivered') {
                if (d.status !== 'picked_up' || order.status !== 'out_for_delivery') {
                    throw httpError(409, 'Mark the order as picked up first');
                }
                return;
            }
            throw httpError(403, 'Riders can only mark pickup and delivery');
        }
        default:
            throw httpError(403, 'This user cannot change the order status');
    }
}

const releaseCoupon = (couponId) =>
    couponId ? Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }) : null;

async function change({ order, status, actor, note, tenant }) {
    if (!order) throw httpError(404, 'Order not found');
    if (!actor || !ACTOR_TYPES.includes(actor.type)) throw httpError(500, 'Status change needs an actor');

    const text = cleanNote(note);
    checkAllowed({ order, status, actor, note: text, tenant });

    const set = { status };
    if (status === 'delivered') {
        set.deliveredAt = new Date();
        if (order.payment?.method === 'cod') set['payment.status'] = 'paid';   // cash collected at the door
    }
    // keep the delivery block in line when a rider is on this order
    const d = order.delivery || {};
    if (d.riderId) {
        if (status === 'out_for_delivery' && d.status === 'accepted') {
            set['delivery.status'] = 'picked_up';
            set['delivery.pickedUpAt'] = new Date();
        }
        if (status === 'delivered' && ['accepted', 'picked_up'].includes(d.status)) {
            set['delivery.status'] = 'delivered';
            set['delivery.deliveredAt'] = new Date();
            if (order.payment?.method === 'cod') set['delivery.cashCollectedPaise'] = Math.round((order.pricing?.total || 0) * 100);
        }
    }
    if (status === 'cancelled') {
        set.cancelledBy = CANCELLED_BY[actor.type];
        set.cancelReason = text || (actor.type === 'superadmin' ? 'Force cancelled by Superadmin' : undefined);
    }

    const historyNote = actor.type === 'superadmin' ? `Superadmin: ${text || 'override'}` : text;

    // The status filter makes this fail if someone else moved the order a moment ago.
    // Because of it, the follow-up work below runs only once per order.
    const updated = await Order.findOneAndUpdate(
        { _id: order._id, tenantId: order.tenantId, status: order.status },
        {
            $set: set,
            $push: {
                statusHistory: {
                    status,
                    by: actor.id || undefined,
                    byType: actor.type,
                    byLabel: actor.label ? String(actor.label).slice(0, 80) : undefined,
                    note: historyNote,
                },
            },
        },
        { new: true },
    );
    if (!updated) throw httpError(409, 'This order was just updated. Refresh and try again.');

    if (status === 'cancelled') {
        await releaseCoupon(updated.couponId);
        // PHASE 4: refund here if the order was paid online
    }

    if (status === 'delivered') {
        // Billing counter first: delivered orders only. It never goes down.
        await Tenant.updateOne({ _id: updated.tenantId }, { $inc: { 'billing.deliveredCount': 1 } });

        // Bestseller count: skip orders bought by shop owners. A failure here must not hurt the order.
        try {
            const buyer = await User.findById(updated.userId).select('role').lean();
            if (!buyer || buyer.role !== 'admin') {
                await Product.bulkWrite(updated.items.map((l) => ({
                    updateOne: { filter: { _id: l.productId, tenantId: updated.tenantId }, update: { $inc: { orderCount: l.quantity } } },
                })));
            }
        } catch (e) {
            console.error('Bestseller count error:', e.message);
        }
    }

    // the rider has one less active order when it ends; COD cash goes to the ledger
    if (['delivered', 'cancelled'].includes(status) && updated.delivery?.riderId) {
        await Rider.updateOne(
            { tenantId: updated.tenantId, userId: updated.delivery.riderId, activeOrderCount: { $gt: 0 } },
            { $inc: { activeOrderCount: -1 } },
        ).catch((e) => console.error('Rider count error:', e.message));
        // last order finished: forget the saved location
        await Rider.updateOne(
            { tenantId: updated.tenantId, userId: updated.delivery.riderId, activeOrderCount: 0 },
            { $unset: { lastLocation: 1 } },
        ).catch((e) => console.error('Rider location clear error:', e.message));
    }
    if (status === 'delivered' && updated.delivery?.riderId && updated.delivery.cashCollectedPaise > 0) {
        await CodSettlement.create({
            tenantId: updated.tenantId, riderId: updated.delivery.riderId, orderId: updated._id,
            type: 'collect', amountPaise: updated.delivery.cashCollectedPaise,
            actor: { type: actor.type, id: actor.id ? String(actor.id) : undefined, label: actor.label },
        }).catch((e) => { if (e.code !== 11000) console.error('COD ledger error:', e.message); });
    }

    notify.orderStatusChanged(updated, status, actor);   // customer, owner, rider (never throws)
    // automatic mode: offer the order to a rider as soon as it is being prepared
    if (status === 'preparing' && updated.orderType === 'delivery' && !updated.delivery?.riderId) {
        require('./assignmentService').autoOnPreparing(updated)
            .catch((e) => console.error('Auto-assign error:', e.message));
    }

    return updated;
}

module.exports = { change };