// The ONE place where an order's status changes.
// Shop owner, customer, superadmin, rider and timers all call change().
//
//   await orderStatus.change({
//       order,                                   // the Order document
//       status: 'accepted',
//       actor: { type: 'owner', id: userId, label: '9876543210' },
//       note: 'optional',
//       reasonCode: 'busy',                      // needed for: owner cancel, owner undelivered. Optional for superadmin and system.
//       tenant,                                  // only needed for actor.type 'customer' (the frozen-shop rule)
//   });
//
// actor.type is one of: customer, owner, rider, superadmin, system.
// Cancel and undelivered work out the money with orderOutcome (pure). Rules are in Handover 4, sections 4 and 6.

const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');
const User = require('../models/User');
const Rider = require('../models/Rider');
const CodSettlement = require('../models/CodSettlement');
const {
    nextStatuses, customerCanCancel, canMarkUndelivered, shopFrozen, ACTIVE_STATUSES,
} = require('./orderflow');
const {
    outcomeFor, OWNER_CANCEL_REASONS, ADMIN_CANCEL_REASONS, SYSTEM_CANCEL_REASONS, UNDELIVERED_REASONS,
} = require('./orderOutcome');
const risk = require('./customerRisk');
const refundService = require('./refundService');
const billable = require('./billableService');
const stockService = require('./stockService');
const riderEarnings = require('./riderEarnings');
const { httpError } = require('../middlewares/apiErrors');
const notify = require('./notificationService');
const liveFeed = require('./liveFeed');
const { isUnpaidOnline } = require('./onlineOrder');

const CANCELLED_BY = { customer: 'customer', owner: 'shop', superadmin: 'admin', system: 'system' };
const ACTOR_TYPES = ['customer', 'owner', 'rider', 'superadmin', 'system'];
const CANCEL_LABEL = {
    busy: 'The shop is too busy right now',
    out_of_stock: 'An item is out of stock',
    shop_fault: 'A problem at the shop',
    customer_asked: 'Cancelled at your request',
    customer_fault: 'Cancelled at your request',
    platform: 'Cancelled by the platform',
};

const cleanNote = (note) => (typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : undefined);
const logError = (what) => (e) => console.error(`${what}:`, e.message);

// Throws a clear error if this actor may not make this move
function checkAllowed({ order, status, actor, note, tenant, reasonCode, now }) {
    switch (actor.type) {
        case 'owner':
            if (isUnpaidOnline(order)) throw httpError(409, 'Waiting for the customer to pay. You can accept the order once it is paid.');
            if (status === 'undelivered') {
                if (!UNDELIVERED_REASONS.includes(reasonCode)) throw httpError(400, 'Choose who is at fault: customer, shop or rider');
                const u = canMarkUndelivered(order, now);
                if (!u.ok) throw httpError(409, u.message);
                return;
            }
            if (!nextStatuses(order, now).includes(status)) {
                throw httpError(409, `This order is "${order.status}". It cannot move to "${status}".`);
            }
            if (status === 'cancelled') {
                if (!OWNER_CANCEL_REASONS.includes(reasonCode)) {
                    throw httpError(400, `Choose a reason for cancelling: ${OWNER_CANCEL_REASONS.join(', ')}`);
                }
                if (reasonCode === 'other' && !note) throw httpError(400, 'Please write the reason for cancelling');
            }
            return;
        case 'customer':
            if (status !== 'cancelled') throw httpError(403, 'Customers can only cancel');
            if (!customerCanCancel(order, tenant)) {
                const cod = !order.payment?.method || order.payment.method === 'cod';
                throw httpError(409, cod
                    ? 'You can cancel until the shop starts preparing your order. Please call the shop.'
                    : 'This order can no longer be cancelled.');
            }
            return;
        case 'superadmin':
            if (isUnpaidOnline(order) && status !== 'cancelled') throw httpError(409, 'The customer has not paid yet');
            if (!ACTIVE_STATUSES.includes(order.status)) {
                throw httpError(409, `This order is already "${order.status}" and cannot be changed`);
            }
            // the owner's normal next step, or a force to cancelled / delivered ("undelivered" is the owner's decision)
            if (!nextStatuses(order, now).filter((s) => s !== 'undelivered').includes(status) && !['cancelled', 'delivered'].includes(status)) {
                throw httpError(400, 'Superadmin can move an order one step forward, or force it to cancelled or delivered');
            }
            if (status === 'cancelled' && reasonCode !== undefined && !ADMIN_CANCEL_REASONS.includes(reasonCode)) {
                throw httpError(400, `reasonCode must be one of: ${ADMIN_CANCEL_REASONS.join(', ')}`);
            }
            return;
        case 'system':
            if (status !== 'cancelled') throw httpError(403, 'The system can only cancel');
            if (!ACTIVE_STATUSES.includes(order.status)) throw httpError(409, 'This order is already finished');
            if (reasonCode !== undefined && !SYSTEM_CANCEL_REASONS.includes(reasonCode)) throw httpError(400, 'Invalid reason');
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

const releaseCoupon = async (couponId) => {
    if (!couponId) return null;
    return Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
};

async function change({ order, status, actor, note, tenant, reasonCode }) {
    if (!order) throw httpError(404, 'Order not found');
    if (!actor || !ACTOR_TYPES.includes(actor.type)) throw httpError(500, 'Status change needs an actor');

    const now = new Date();
    const text = cleanNote(note);
    checkAllowed({ order, status, actor, note: text, tenant, reasonCode, now });

    // cancel and undelivered: who pays what, and what it means for billing, strikes and the coupon
    const outcome = status === 'cancelled' || status === 'undelivered'
        ? outcomeFor({
            order, kind: status === 'cancelled' ? 'cancel' : 'undelivered', actorType: actor.type, reasonCode,
            frozen: actor.type === 'customer' && shopFrozen(tenant), now,
        })
        : null;

    // what this delivery pays the rider (shop setting, copied now so later changes never touch it)
    const earnPaise = status === 'delivered' && order.delivery?.riderId
        ? await riderEarnings.payPerDeliveryPaise(order.tenantId).catch(() => 0)
        : 0;
    const set = { status };
    if (status === 'delivered') {
        set.deliveredAt = now;
        if (order.payment?.method === 'cod') set['payment.status'] = 'paid';   // cash collected at the door
    }
    // keep the delivery block in line when a rider is on this order
    const d = order.delivery || {};
    if (d.riderId) {
        if (status === 'out_for_delivery' && d.status === 'accepted') {
            set['delivery.status'] = 'picked_up';
            set['delivery.pickedUpAt'] = now;
        }
        if (status === 'delivered' && ['accepted', 'picked_up'].includes(d.status)) {
            set['delivery.status'] = 'delivered';
            set['delivery.deliveredAt'] = now;
            set['delivery.earnPaise'] = earnPaise;
            if (order.payment?.method === 'cod') set['delivery.cashCollectedPaise'] = Math.round((order.pricing?.total || 0) * 100);
        }
    }
    if (status === 'cancelled') {
        set.cancelledBy = CANCELLED_BY[actor.type];
        set.cancelReason = text || CANCEL_LABEL[outcome.reasonCode] || (actor.type === 'superadmin' ? 'Force cancelled by Superadmin' : undefined);
        set.cancel = {
            by: CANCELLED_BY[actor.type], reasonCode: outcome.reasonCode,
            keptPaise: outcome.keptPaise, refundPaise: outcome.refundPaise,
        };
    }
    if (status === 'undelivered') {
        set.undelivered = {
            reasonCode: outcome.reasonCode, note: text, at: now, by: actor.label ? String(actor.label).slice(0, 80) : actor.type,
            keptPaise: outcome.keptPaise, refundPaise: outcome.refundPaise,
        };
    }

    const historyNote = actor.type === 'superadmin'
        ? `Superadmin: ${text || 'override'}`
        : (text || (status === 'cancelled' ? CANCEL_LABEL[outcome.reasonCode] : undefined)
            || (status === 'undelivered' ? `Not delivered (${outcome.reasonCode})` : undefined));

    // The status filter makes this fail if someone else moved the order a moment ago.
    // Because of it, the follow-up work below runs only once per order.
    const updated = await Order.findOneAndUpdate(
        // payment.status must be unchanged too, because the refund maths above used it. If a payment landed meanwhile, it answers 409 and the caller tries again.
        { _id: order._id, tenantId: order.tenantId, status: order.status, ...(order.payment?.status ? { 'payment.status': order.payment.status } : {}) },
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
        { returnDocument: 'after' },
    );
    if (!updated) throw httpError(409, 'This order was just updated. Refresh and try again.');

    if (outcome) {
        // The coupon use goes back ONLY when the customer got a full refund (the shop kept nothing)
        if (outcome.couponReturn) {
            await releaseCoupon(updated.couponId).catch(logError('Coupon release error'));
            // the shop kept nothing, so the stock units go back too
            await stockService.restoreForOrder(updated).catch(logError('Stock restore error'));
        }
        // The shop kept money: the order counts for the rent
        if (outcome.billable) {
            await billable.markBillable(updated, status === 'undelivered' ? 'undelivered_customer' : 'cancel_kept')
                .catch(logError('Billable count error'));
        }
        // Money back to the customer (online orders that were paid). It is saved with a fixed key first, so it can never go out twice.
        // If this step fails, the reconcile job finds the order and sends the refund (paymentReconcile).
        if (outcome.refundPaise > 0) {
            await refundService.issueRefund({
                tenantId: updated.tenantId, orderId: updated._id, amountPaise: outcome.refundPaise,
                reason: status, key: `order:${updated._id}:${status === 'cancelled' ? 'cancel' : 'undelivered'}`,
            }).catch(logError('Refund error'));
        }
        if (outcome.strike) await risk.addStrike(updated).catch(logError('Strike error'));
    }

    if (status === 'delivered') {
        // Billing counter: orders that earned money. It never goes down.
        await billable.markDelivered(updated).catch(logError('Billable count error'));

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
    if (['delivered', 'cancelled', 'undelivered'].includes(status) && updated.delivery?.riderId) {
        await Rider.updateOne(
            { tenantId: updated.tenantId, userId: updated.delivery.riderId, activeOrderCount: { $gt: 0 } },
            { $inc: { activeOrderCount: -1 } },
        ).catch(logError('Rider count error'));
        // last order finished: forget the saved location
        await Rider.updateOne(
            { tenantId: updated.tenantId, userId: updated.delivery.riderId, activeOrderCount: 0 },
            { $unset: { lastLocation: 1 } },
        ).catch(logError('Rider location clear error'));
    }
    if (status === 'delivered' && updated.delivery?.riderId && updated.delivery.cashCollectedPaise > 0) {
        await CodSettlement.create({
            tenantId: updated.tenantId, riderId: updated.delivery.riderId, orderId: updated._id,
            type: 'collect', amountPaise: updated.delivery.cashCollectedPaise,
            actor: { type: actor.type, id: actor.id ? String(actor.id) : undefined, label: actor.label },
        }).catch((e) => { if (e.code !== 11000) console.error('COD ledger error:', e.message); });
    }

    notify.orderStatusChanged(updated, status, actor);   // customer, owner, rider (never throws)
    // the live feed (no phone numbers, never throws)
    liveFeed.emit(updated.tenantId, 'orders', {
        type: `order.${status}`, orderId: String(updated._id), orderNo: updated.orderNo, status,
        by: actor.type, reasonCode: outcome?.reasonCode, total: updated.pricing?.total,
    });
    if (actor.type === 'rider') {
        liveFeed.emit(updated.tenantId, 'riders', { type: `rider.${status}`, orderNo: updated.orderNo, riderId: String(actor.id) });
    }
    // the owner accepted a delivery order: ask ALL free riders at once (automatic mode). The first one to accept gets it.
    if (status === 'accepted' && updated.orderType === 'delivery' && !updated.delivery?.riderId) {
        require('./assignmentService').startBroadcast({ orderId: updated._id, tenantId: updated.tenantId })
            .catch((e) => console.error('Rider broadcast error:', e.message));
    }
    // the order is over: stop asking riders
    if (['cancelled', 'undelivered', 'delivered'].includes(status) && updated.orderType === 'delivery') {
        require('./assignmentService').endBroadcast(updated._id, updated.tenantId, 'cancelled')
            .catch((e) => console.error('Rider broadcast end error:', e.message));
    }

    return updated;
}

module.exports = { change };