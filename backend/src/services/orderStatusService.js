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
    outcomeFor, RIDER_CANCEL_REASONS, OWNER_CANCEL_REASONS, ADMIN_CANCEL_REASONS, SYSTEM_CANCEL_REASONS, UNDELIVERED_REASONS,
} = require('./orderOutcome');
const risk = require('./customerRisk');
const liveTracking = require('./liveTracking');
const refundService = require('./refundService');
const billable = require('./billableService');
const stockService = require('./stockService');
const riderPay = require('./riderPay');
const { httpError } = require('../middlewares/apiErrors');
const notify = require('./notificationService');
const liveFeed = require('./liveFeed');
const { isUnpaidOnline } = require('./onlineOrder');

const CANCELLED_BY = { customer: 'customer', owner: 'shop', rider: 'rider', staff: 'shop', superadmin: 'admin', system: 'system' };
const ACTOR_TYPES = ['customer', 'owner', 'rider', 'staff', 'superadmin', 'system'];
const CANCEL_LABEL = {
    busy: 'The shop is too busy right now',
    out_of_stock: 'An item is out of stock',
    shop_fault: 'A problem at the shop',
    customer_asked: 'Cancelled at your request',
    customer_fault: 'Cancelled at your request',
    platform: 'Cancelled by the platform',
    late_delivery: 'The delivery was more than an hour late. You get a full refund.',
    // a rider cancels the delivery he is carrying (these words are shown to the customer and the shop)
    not_answering: 'Our delivery partner could not reach you',
    wrong_address: 'Our delivery partner could not find the address',
    vehicle_problem: "Our delivery partner's vehicle broke down",
    emergency: 'Our delivery partner had an emergency',
    order_damaged: 'The order was damaged on the way',
};

const cleanNote = (note) => (typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : undefined);
const logError = (what) => (e) => console.error(`${what}:`, e.message);

// A delivery order cannot be sent out until a delivery partner is assigned to it
function needsRider(order, status) {
    if (status !== 'out_for_delivery' || order.orderType !== 'delivery') return;
    const d = order.delivery || {};
    if (!d.riderId || d.status === 'rejected') throw httpError(409, 'Assign a delivery partner first. The order can go out for delivery once someone is assigned.');
}

// A delivery order cannot be collected or sent out until the food is ready: the cook marked it, or the owner did ("Food is ready")
function needsFood(order, status) {
    if (status !== 'out_for_delivery' || order.orderType !== 'delivery') return;
    if (!order.kitchen?.readyAt) throw httpError(409, 'The food is not ready yet. It can go out once the cook, or you, marks it ready.');
}

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
            needsRider(order, status);
            needsFood(order, status);
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
            needsRider(order, status);
            needsFood(order, status);
            // the owner's normal next step, or a force to cancelled / delivered ("undelivered" is the owner's decision)
            if (!nextStatuses(order, now).filter((s) => s !== 'undelivered').includes(status) && !['cancelled', 'delivered'].includes(status)) {
                throw httpError(400, 'Superadmin can move an order one step forward, or force it to cancelled or delivered');
            }
            if (status === 'cancelled' && reasonCode !== undefined && !ADMIN_CANCEL_REASONS.includes(reasonCode)) {
                throw httpError(400, `reasonCode must be one of: ${ADMIN_CANCEL_REASONS.join(', ')}`);
            }
            return;
        case 'system':
            if (status === 'accepted') {   // the owner switched on auto accept (services/autoAccept.js)
                if (order.status !== 'placed') throw httpError(409, 'This order is no longer waiting');
                if (isUnpaidOnline(order)) throw httpError(409, 'The customer has not paid yet');
                return;
            }
            if (status === 'preparing') {   // auto accept with "start preparing at once"
                if (order.status !== 'accepted') throw httpError(409, 'This order is not waiting to be prepared');
                return;
            }
            if (status === 'ready') {   // a dine in dish is marked ready by itself after the average time (tableBill.autoReady)
                if (order.orderType !== 'dine_in' || order.status !== 'preparing') throw httpError(409, 'This order is not being prepared');
                return;
            }
            if (status === 'delivered') {   // a ready dine in dish is marked served by itself (tableBill.autoReady, the owner's choice)
                if (order.orderType !== 'dine_in' || order.status !== 'ready') throw httpError(409, 'This order is not waiting to be served');
                return;
            }
            if (status !== 'cancelled') throw httpError(403, 'The system can only cancel or accept');
            if (!ACTIVE_STATUSES.includes(order.status)) throw httpError(409, 'This order is already finished');
            if (reasonCode !== undefined && !SYSTEM_CANCEL_REASONS.includes(reasonCode)) throw httpError(400, 'Invalid reason');
            return;
        case 'staff':   // actor.role: 'kitchen' (the cook). Never cancels, never touches money.
            if (isUnpaidOnline(order)) throw httpError(409, 'Waiting for the customer to pay');
            if (actor.role === 'kitchen' && status === 'preparing') {
                if (order.status !== 'accepted') throw httpError(409, `This order is "${order.status}". It is not waiting to be cooked.`);
                return;
            }
            // a delivery order has no "ready" step (the rider takes it from "preparing"): the kitchen marks it on the order instead (services/kitchenService.js)
            if (actor.role === 'kitchen' && status === 'ready') {
                if (order.orderType === 'delivery' || order.status !== 'preparing') throw httpError(409, `This order is "${order.status}". It is not being cooked.`);
                return;
            }
            if (actor.role === 'waiter' && status === 'delivered') {   // the dish is at the table
                if (order.orderType !== 'dine_in') throw httpError(403, 'A waiter serves dishes at tables only');
                if (order.status !== 'ready') throw httpError(409, `This order is "${order.status}". It is not ready to serve.`);
                return;
            }
            throw httpError(403, 'You cannot make this change');
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
                needsFood(order, status);
                return;
            }
            if (status === 'delivered') {
                if (d.status !== 'picked_up' || order.status !== 'out_for_delivery') {
                    throw httpError(409, 'Mark the order as picked up first');
                }
                return;
            }
            // He may cancel only a delivery he is carrying (after pickup). Before pickup he gives the order back instead.
            if (status === 'cancelled') {
                if (d.status !== 'picked_up' || order.status !== 'out_for_delivery') {
                    throw httpError(409, 'You can cancel only after you collected the order. Before that, give it back.');
                }
                if (!RIDER_CANCEL_REASONS.includes(reasonCode)) throw httpError(400, 'Choose a reason for cancelling');
                return;
            }
            throw httpError(403, 'Riders can only mark pickup, delivery or cancel what they carry');
        }
        default:
            throw httpError(403, 'This user cannot change the order status');
    }
}

const releaseCoupon = async (couponId) => {
    if (!couponId) return null;
    return Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
};

async function change({ order, status, actor, note, tenant, reasonCode, outcomeOverride, extraSet }) {
    if (!order) throw httpError(404, 'Order not found');
    if (!actor || !ACTOR_TYPES.includes(actor.type)) throw httpError(500, 'Status change needs an actor');

    const now = new Date();
    const text = cleanNote(note);
    checkAllowed({ order, status, actor, note: text, tenant, reasonCode, now });

    // cancel and undelivered: who pays what, and what it means for billing, strikes and the coupon
    const rules = status === 'cancelled' || status === 'undelivered' ? await require('./moneyRules').forTenant(order.tenantId).catch(() => null) : null;   // who bears the cost: the platform's rules, or the shop's kinder ones
    const outcome = outcomeOverride || (status === 'cancelled' || status === 'undelivered'
        ? outcomeFor({ rules,
            order, kind: status === 'cancelled' ? 'cancel' : 'undelivered', actorType: actor.type, reasonCode,
            frozen: actor.type === 'customer' && shopFrozen(tenant), now,
        })
        : null);

    // what this delivery pays the rider (shop setting, copied now so later changes never touch it)
    const earnPaise = status === 'delivered' && order.delivery?.riderId
        ? await riderPay.earnForOrder(order).catch(() => 0)
        : 0;
    // food collected but not delivered: paid only when the shop chose to (a shop setting)
    const notDeliveredPay = ['undelivered', 'cancelled'].includes(status) && actor.type !== 'rider' && order.delivery?.riderId && order.delivery?.status === 'picked_up'
        ? await riderPay.earnForOrder(order, { notDelivered: true }).catch(() => 0)
        : 0;
    const set = { status, ...(extraSet || {}) };
    if (notDeliveredPay > 0) set['delivery.earnPaise'] = notDeliveredPay;
    if (status === 'delivered') {
        set.deliveredAt = now;
        if (order.payment?.method === 'cod' && !order.tableSessionId) set['payment.status'] = 'paid';   // cash collected at the door (a table's round is paid when the table bill is settled)
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
        set.cancelReason = actor.type === 'rider'
            ? [CANCEL_LABEL[outcome.reasonCode], text].filter(Boolean).join(': ')
            : (text || CANCEL_LABEL[outcome.reasonCode] || (actor.type === 'superadmin' ? 'Force cancelled by Superadmin' : undefined));
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

    // a table visit whose every round is cancelled is closed at once
    if (updated.tableSessionId && (status === 'cancelled' || status === 'undelivered')) require('./tableBill').closeEmpty(updated.tenantId, updated.tableSessionId).catch(logError('Table close error'));

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

    // the rider's list of orders on the way is looked up again (live tracking keeps it for a few seconds)
    if (updated.delivery?.riderId) liveTracking.orderChanged(updated.delivery.riderId);
    if (['delivered', 'cancelled', 'undelivered'].includes(status)) require('./tripEta').drop(updated._id);
    // the rider has one less active order when it ends; COD cash goes to the ledger
    if (['delivered', 'cancelled', 'undelivered'].includes(status) && updated.delivery?.riderId) {
        await Rider.updateOne(
            { tenantId: updated.tenantId, userId: updated.delivery.riderId, activeOrderCount: { $gt: 0 } },
            { $inc: { activeOrderCount: -1 } },
        ).catch(logError('Rider count error'));
        // last order finished: the live position in memory goes (nothing is saved in the database)
        if (await Rider.exists({ tenantId: updated.tenantId, userId: updated.delivery.riderId, activeOrderCount: 0 }).catch(() => null)) liveTracking.forget(updated.delivery.riderId);
    }
    if (status === 'delivered' && updated.delivery?.riderId && updated.delivery.cashCollectedPaise > 0) {
        await CodSettlement.create({
            tenantId: updated.tenantId, riderId: updated.delivery.riderId, orderId: updated._id,
            type: 'collect', amountPaise: updated.delivery.cashCollectedPaise,
            actor: { type: actor.type, id: actor.id ? String(actor.id) : undefined, label: actor.label },
        }).catch((e) => { if (e.code !== 11000) console.error('COD ledger error:', e.message); });
    }

    notify.orderStatusChanged(updated, status, actor);   // customer, owner, rider (never throws)
    require('./kitchenAlerts').onStatus({ before: order, updated, status }).catch(logError('Kitchen alert error'));   // the cooks' screens and phones
    // points: delivered = the customer's wait starts and the rider is scored; cancelled = the points he used go back
    const points = require('./loyaltyService');
    if (status === 'delivered') points.onDelivered(updated).catch(logError('Points error'));
    if (status === 'cancelled') {
        Promise.resolve(points.returnForOrder(updated)).catch(logError('Points give-back error'));
        if (actor.type === 'rider' && order.delivery?.status === 'picked_up' && order.delivery?.riderId) points.onRiderCancelledAfterPickup(updated).catch(logError('Points error'));
    }
    // the live feed (no phone numbers, never throws)
    liveFeed.emit(updated.tenantId, 'orders', {
        type: `order.${status}`, orderId: String(updated._id), orderNo: updated.orderNo, status,
        by: actor.type, reasonCode: outcome?.reasonCode, total: updated.pricing?.total,
    });
    if (actor.type === 'rider') {
        liveFeed.emit(updated.tenantId, 'riders', { type: `rider.${status}`, orderNo: updated.orderNo, riderId: String(actor.id) });
    }
    // the food was collected: save the time allowed for the journey. It was delivered: add the journey to the rider's record.
    if (status === 'out_for_delivery' && updated.delivery?.riderId && updated.delivery?.pickedUpAt && !updated.delivery?.dueAt) {
        require('./deliveryPlan').recordStart(updated, tenant);
    }
    if (status === 'delivered' && updated.delivery?.riderId) require('./deliveryPlan').recordDone(updated);
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