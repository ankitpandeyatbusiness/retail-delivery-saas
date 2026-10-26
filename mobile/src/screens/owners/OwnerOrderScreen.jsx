// One order, everything about it: the items, the bill, the customer, the address, the rider, the timeline, and the
// buttons to move it on. Opening it silences the new-order alert for it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable, AppState } from 'react-native';
import { Image } from 'expo-image';
import PhotoViewer from '../../components/common/PhotoViewer';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Button, Pill, Empty, money } from '../../components/owners/ui';
import {
    StatusPill, useToneColors, PayBadge, Countdown, RiderSheet, useOrderActions, callPhone, whatsApp, openMap, addressLine, openInvoice,
} from '../../components/owners/orderBits';
import { fetchOrder, fetchDelivery, fetchRiders, undoOrderStep, apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { BlockSheet } from '../../components/owners/BlockSheet';
import KitchenProblemActions from '../../components/owners/KitchenProblemActions';
import { onOrderUpdate, onNotification } from '../../api/common/socket';
import { acknowledge } from '../../utils/owners/soundbox';
import { useNow } from '../../hooks/owners/useNow';
import * as flow from '../../utils/owners/orderFlow';
import { FormShimmer } from '../../components/owners/shimmer';
import RiderLiveMap from '../../components/owners/RiderLiveMap';
import TripClock from '../../components/riders/TripClock';
import { Avatar } from './OwnerRidersScreen';
import { tr } from '../../i18n';

// Everything that happened to the order, newest first: every step, and the kitchen's and the delivery partner's own moments
function timeline(o) {
    const k = o.kitchen || {};
    const d = o.delivery || {};
    const by = (h) => (h.byType ? (h.byType === 'owner' ? 'you' : h.byType === 'staff' ? (h.byLabel || 'kitchen') : h.byType) : '');
    const rows = (o.statusHistory || []).map((h) => ({ label: flow.statusLabel(h.status), at: h.at, by: by(h), note: h.note, tone: flow.statusTone(h.status) }));
    if (k.queuedAt) rows.push({ label: 'Added to the cook\'s queue', at: k.queuedAt, by: k.queuedBy === 'auto' ? 'itself' : k.queuedBy });
    if (k.startedAt) rows.push({ label: 'Cooking started', at: k.startedAt, by: k.startedByName });
    if (k.readyAt) rows.push({ label: 'Food is ready', at: k.readyAt, by: k.readyByName });
    if (d.assignedAt) rows.push({ label: 'Delivery partner assigned', at: d.assignedAt });
    if (d.arrivedAt) rows.push({ label: 'Delivery partner arrived', at: d.arrivedAt });
    if (d.pinSkipped?.at) rows.push({ label: 'Delivered without the PIN', at: d.pinSkipped.at, tone: 'warn' });
    return rows.filter((r) => r.at).sort((a, b) => new Date(b.at) - new Date(a.at));
}

const UNDELIVERED_WAIT_MS = 15 * 60 * 1000;   // the server allows "not delivered" 15 minutes after the rider's first problem

function Line({ label, value, bold, color }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
            <Text style={{ flex: 1, color: bold ? text : muted, fontWeight: bold ? '900' : '600', fontSize: bold ? 16 : 14 }}>{label}</Text>
            <Text style={{ color: color || text, fontWeight: bold ? '900' : '700', fontSize: bold ? 16 : 14 }}>{value}</Text>
        </View>
    );
}

// the rider's side of a delivery, in words
function riderStatusText(delivery, rider) {
    if (!delivery) return 'No rider yet';
    const name = rider?.name || rider?.phone || 'The rider';
    if (delivery.broadcast?.active) return 'Asked all free riders. Waiting for one to accept.';
    switch (delivery.status) {
        case 'assigned': return `Offered to ${name}. Waiting for an answer.`;
        case 'accepted': return `${name} accepted and is on the way to the shop.`;
        case 'picked_up': return `${name} picked it up and is delivering.`;
        case 'delivered': return `${name} delivered it.`;
        case 'rejected': return `${name} said no. Choose another rider.`;
        default: return delivery.riderId ? `${name} is assigned.` : 'No rider yet';
    }
}

export default function OwnerOrderScreen() {
    const { id } = useRoute().params || {};
    const { background, text, muted, error, ok, accent } = useBrand();
    const tones = useToneColors();
    const [order, setOrder] = useState(null);
    const [delivery, setDelivery] = useState(null);
    const [riders, setRiders] = useState([]);
    const [failed, setFailed] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [riderOpen, setRiderOpen] = useState(false);
    const [blockOpen, setBlockOpen] = useState(false);
    const [dockH, setDockH] = useState(220);   // the height of the buttons fixed at the bottom
    const [invoiceBusy, setInvoiceBusy] = useState(false);
    const now = useNow(1000, true);
    const alive = useRef(true);
    const [viewing, setViewing] = useState(null);   // the delivery photo, full screen

    const load = useCallback(async () => {
        try {
            const o = await fetchOrder(id);
            if (!alive.current) return;
            setOrder(o); setFailed(false);
            if (o.orderType === 'delivery') {
                fetchDelivery(id).then((r) => alive.current && setDelivery(r.delivery || null)).catch(() => { });
                fetchRiders().then((r) => alive.current && setRiders(r.items || [])).catch(() => { });
            }
        } catch (e) { if (alive.current) setFailed(true); }
    }, [id]);

    useEffect(() => {
        alive.current = true;
        acknowledge(id);   // he is looking at it: the new-order alert stops for this order
        load();
        // this order changed somewhere else (a rider answered, another phone accepted it): show the new state
        const off = onOrderUpdate((p) => { if (String(p?.orderId) === String(id)) load(); });
        const offN = onNotification((n) => { if (String(n?.data?.orderId) === String(id)) load(); });   // anything said about this order
        const every = setInterval(() => { if (AppState.currentState === 'active') load(); }, 6000);   // and a look every few seconds, so the page never waits for a message
        return () => { alive.current = false; off(); offN(); clearInterval(every); };
    }, [id, load]);

    const actions = useOrderActions({ onChanged: (o) => { setOrder(o); load(); }, onOptimistic: setOrder });

    const [undoing, setUndoing] = useState(false);
    const undoLast = async () => {
        if (undoing) return;
        setUndoing(true);
        try { const r = await undoOrderStep(id); if (r?.order) setOrder(r.order); showToast(tr('Undone')); load(); } catch (e) { showToast(apiError(e)); load(); } finally { setUndoing(false); }
    };
    const pull = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (failed && !order) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Order')} />
                <Empty icon="alert-circle-outline" title={tr('Could not open this order')} hint={tr('Check your connection and try again.')} />
                <View style={{ paddingHorizontal: 16 }}><Button label={tr('Try again')} onPress={load} /></View>
            </View>
        );
    }
    if (!order) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Order')} />
                <FormShimmer cards={2} />
            </View>
        );
    }

    const next = flow.forwardStep(order);
    const isNew = order.status === 'placed';
    const busy = actions.busyId === order.id;
    const riderId = delivery?.riderId || order.delivery?.riderId;
    const rider = riders.find((r) => String(r.userId) === String(riderId));
    const p = order.pricing || {};
    const warn = accent || '#F59E0B';

    // "not delivered" is allowed 15 minutes after the rider's first reported problem
    const firstProblem = delivery?.problems?.[0];
    const undeliveredWait = firstProblem?.at ? new Date(firstProblem.at).getTime() + UNDELIVERED_WAIT_MS - now : null;

    const showRider = order.orderType === 'delivery' && !flow.isFinal(order.status) ? true : !!riderId;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Order #{orderNo}', { orderNo: order.orderNo })} right={<StatusPill status={order.status} order={order} />} />

            <ScrollView
                contentContainerStyle={{ paddingBottom: next ? dockH + 24 : 32 }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} />}
            >
                {isNew && order.acceptBy ? (
                    <Card tone={warn} style={{ marginTop: 6 }}>
                        <Countdown until={order.acceptBy} />
                        <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{tr('Accept or reject before the time runs out. Otherwise the order is cancelled and the customer is refunded.')}</Text>
                    </Card>
                ) : null}

                {order.status === 'cancelled' || order.status === 'undelivered' ? (
                    <Card tone={error} style={{ marginTop: 6 }}>
                        <Text style={{ color: error, fontWeight: '900' }}>{flow.statusLabel(order.status)}</Text>
                        {order.cancelReason ? <Text style={{ color: text, marginTop: 4 }}>{order.cancelReason}</Text> : null}
                        {order.undelivered?.note ? <Text style={{ color: text, marginTop: 4 }}>{order.undelivered.note}</Text> : null}
                    </Card>
                ) : null}

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 10, marginBottom: 4 }}>
                    <View style={{ marginRight: 6, marginBottom: 6 }}><Pill label={flow.typeLabel(order.orderType)} color={muted} /></View>
                    <View style={{ marginRight: 6, marginBottom: 6 }}><PayBadge order={order} /></View>
                    {order.scheduledFor ? <View style={{ marginBottom: 6 }}><Pill label={tr('For {v1}', { v1: flow.dayTime(order.scheduledFor) })} color={warn} icon="calendar-outline" /></View> : null}
                </View>
                <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginBottom: 8 }}>{tr('Placed {v1} · {v2}', { v1: flow.dayTime(order.createdAt), v2: flow.ago(order.createdAt, now) })}</Text>

                <SectionTitle title={tr('Items ({v1})', { v1: flow.itemCount(order) })} />
                <Card>
                    {(order.items || []).map((l, i) => (
                        <View key={i} style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: i === order.items.length - 1 ? 0 : 1, borderBottomColor: alpha(muted, 0.25) }}>
                            <Text style={{ color: text, fontWeight: '900', width: 38, fontSize: 15 }}>{l.measure?.label ? '' : `${l.quantity}×`}</Text>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{l.measure?.label ? `${l.measure.label} ` : ''}{l.name}</Text>
                                {(l.selections || []).length ? (
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{l.selections.map((x) => x.name).join(' · ')}</Text>
                                ) : null}
                                {l.note ? <Text style={{ color: warn, fontSize: 12, fontWeight: '700', marginTop: 2 }}>{tr('Note: {note}', { note: l.note })}</Text> : null}
                            </View>
                            <Text style={{ color: text, fontWeight: '700', marginLeft: 8 }}>{money(l.lineTotal)}</Text>
                        </View>
                    ))}
                    {order.note ? (
                        <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: alpha(warn, 0.14) }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 12 }}>{tr('CUSTOMER\'S INSTRUCTIONS')}</Text>
                            <Text style={{ color: text, marginTop: 2, fontWeight: '900', fontSize: 15 }}>{order.note}</Text>
                        </View>
                    ) : null}
                </Card>

                <SectionTitle title={tr('Bill')} />
                <Card>
                    <Line label={tr('Items')} value={money(p.subtotal)} />
                    {p.packagingCharge ? <Line label={tr('Packaging')} value={money(p.packagingCharge)} /> : null}
                    {p.deliveryFee ? <Line label={tr('Delivery fee')} value={money(p.deliveryFee)} /> : null}
                    {p.discount ? <Line label={p.couponCode ? tr('Discount ({couponCode})', { couponCode: p.couponCode }) : tr('Discount')} value={`− ${money(p.discount)}`} color={ok} /> : null}
                    {p.tax ? <Line label={tr('Tax{v1}', { v1: p.taxMode === 'inclusive' ? ' (included)' : '' })} value={money(p.tax)} /> : null}
                    {p.tip ? <Line label={tr('Tip for the rider')} value={money(p.tip)} /> : null}
                    <View style={{ height: 1, backgroundColor: alpha(muted, 0.3), marginVertical: 6 }} />
                    <Line label={tr('Total')} value={money(p.total)} bold />
                    <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{flow.paymentLabel(order)}</Text>
                </Card>

                <SectionTitle title={tr('Customer')} />
                <Card>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{order.customer?.name || tr('Customer')}</Text>
                    {order.customer?.phone ? <Text style={{ color: muted, marginTop: 2 }}>{order.customer.phone}</Text> : null}
                    {order.customer?.phone && !order.customer?.deleted ? (
                        <View style={{ flexDirection: 'row', marginTop: 10 }}>
                            <Button label={tr('Call')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(order.customer.phone)} style={{ flex: 1, marginRight: 8 }} />
                            <Button label={tr('WhatsApp')} icon="logo-whatsapp" iconOnly kind="ghost" onPress={() => whatsApp(order.customer.phone)} style={{ flex: 1 }} />
                        </View>
                    ) : null}
                    {order.userId && !order.customer?.deleted ? (
                        <Button label={tr('Block this customer')} icon="ban" kind="ghost" onPress={() => setBlockOpen(true)} style={{ marginTop: 10 }} />
                    ) : null}
                    <BlockSheet visible={blockOpen} customer={{ id: String(order.userId) }} orderId={order.id} onClose={() => setBlockOpen(false)} />
                    {order.orderType === 'dine_in' && order.tableNo ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                            <Ionicons name="restaurant-outline" size={18} color={muted} style={{ marginRight: 8 }} />
                            <Text style={{ color: text, fontWeight: '800' }}>{tr('Table {tableNo}', { tableNo: order.tableNo })}</Text>
                        </View>
                    ) : null}
                    {order.orderType === 'delivery' && order.address ? (
                        <View style={{ marginTop: 12 }}>
                            <View style={{ flexDirection: 'row' }}>
                                <Ionicons name="location-outline" size={18} color={muted} style={{ marginRight: 8, marginTop: 1 }} />
                                <Text style={{ color: text, flex: 1 }}>{addressLine(order.address)}</Text>
                            </View>
                            <Button
                                label={tr('Open in Maps')}
                                icon="navigate"
                                kind="ghost"
                                onPress={() => openMap(order.address.latitude, order.address.longitude, addressLine(order.address))}
                                style={{ marginTop: 10 }}
                            />
                        </View>
                    ) : null}
                </Card>

                {/* the delivery time runs from the moment the rider collects the order; it turns red when he is late */}
                {order.status === 'out_for_delivery' && order.orderType === 'delivery' && (delivery?.dueAt || order.delivery?.dueAt) ? (
                    <TripClock onTheWay due={new Date(delivery?.dueAt || order.delivery?.dueAt).getTime()} style={{ marginHorizontal: 16, marginBottom: 12 }} />
                ) : null}

                {showRider ? (
                    <>
                        <SectionTitle title={tr('Delivery rider')} />
                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {rider ? <View style={{ marginRight: 12 }}><Avatar rider={rider} size={48} /></View> : null}
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontWeight: '800' }}>{riderStatusText(delivery || order.delivery, rider)}</Text>
                                    {rider?.phone ? <Text style={{ color: muted, marginTop: 2 }}>{rider.phone}</Text> : null}
                                </View>
                            </View>
                            {(delivery?.problems || []).map((pr, i) => (
                                <View key={i} style={{ flexDirection: 'row', marginTop: 8 }}>
                                    <Ionicons name="warning" size={16} color={error} style={{ marginRight: 6, marginTop: 1 }} />
                                    <Text style={{ color: error, flex: 1, fontSize: 13 }}>{tr('Rider reported: {v1}{v2} · {v3}', { v1: String(pr.reason || '').replace(/_/g, ' '), v2: pr.note ? ` (${pr.note})` : '', v3: flow.clockTime(pr.at) })}</Text>
                                </View>
                            ))}
                            {order.delivery?.pinSkipped?.reason ? (
                                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                    <Ionicons name="alert-circle" size={16} color={warn} style={{ marginRight: 6, marginTop: 1 }} />
                                    <Text style={{ color: warn, flex: 1, fontSize: 13, fontWeight: '700' }}>{tr('Delivered without the PIN: {reason}', { reason: tr(({ customer_no_phone: 'The customer has no phone with them', app_not_opening: 'The customer app is not opening', pin_not_showing: 'The PIN is not showing for the customer', customer_cannot_find: 'The customer cannot find the PIN', handed_to_family: 'Handed to a family member or a guard', other: 'Another reason' })[order.delivery.pinSkipped.reason] || 'Another reason') })}{order.delivery.pinSkipped.note ? ` (${order.delivery.pinSkipped.note})` : ''}</Text>
                                </View>
                            ) : null}
                            {rider?.phone ? (
                                <Button label={tr('Call the rider')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(rider.phone)} style={{ marginTop: 10 }} />
                            ) : null}
                            {order.status === 'out_for_delivery' && order.orderType === 'delivery' ? (
                                <RiderLiveMap orderId={String(order._id || order.id)} initial={rider?.lastLocation} destination={order.address} riderName={rider?.name} />
                            ) : null}
                            {order.status !== 'out_for_delivery' && rider?.lastLocation?.lat && rider?.lastLocation?.at && now - new Date(rider.lastLocation.at).getTime() < 5 * 60000 ? (
                                <Button label={tr('See where the rider is')} icon="locate" kind="ghost" onPress={() => openMap(rider.lastLocation.lat, rider.lastLocation.lng, rider.name)} style={{ marginTop: 8 }} />
                            ) : null}
                            {!flow.isFinal(order.status) ? (
                                <Button label={riderId ? tr('Change or remove the rider') : tr('Assign a rider')} icon="bicycle" onPress={() => setRiderOpen(true)} style={{ marginTop: 10 }} />
                            ) : null}
                        </Card>
                    </>
                ) : null}

                {(order.foodReviews?.length || order.deliveryRating?.rating) ? (
                    <>
                        <SectionTitle title={tr('Customer review')} />
                        <Card>
                            {(order.foodReviews || []).map((r, i) => (
                                <View key={i} style={{ marginBottom: 10 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ color: text, fontWeight: '800', flex: 1 }} numberOfLines={2}>{r.name}</Text>
                                        <Text style={{ color: '#D97706', fontWeight: '900' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</Text>
                                    </View>
                                    {r.comment ? <Text style={{ color: muted, marginTop: 2 }}>{r.comment}</Text> : null}
                                </View>
                            ))}
                            {order.deliveryRating?.rating ? (
                                <View style={order.foodReviews?.length ? { borderTopWidth: 1, borderTopColor: alpha(muted, 0.25), paddingTop: 10 } : null}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ color: text, fontWeight: '800', flex: 1 }}>{tr('Delivery')}</Text>
                                        <Text style={{ color: '#D97706', fontWeight: '900' }}>{'★'.repeat(order.deliveryRating.rating)}{'☆'.repeat(5 - order.deliveryRating.rating)}</Text>
                                    </View>
                                    {(order.deliveryRating.tags || []).length ? <Text style={{ color: muted, marginTop: 2 }}>{order.deliveryRating.tags.map((t) => String(t).replace(/_/g, ' ')).join(' · ')}</Text> : null}
                                    {order.deliveryRating.comment ? <Text style={{ color: muted, marginTop: 2 }}>{order.deliveryRating.comment}</Text> : null}
                                </View>
                            ) : null}
                        </Card>
                    </>
                ) : null}

                {order.orderType === 'pickup' && order.pickupIntent?.kind ? (
                    <Card>
                        <Text style={{ color: text, fontWeight: '800' }}>{{ coming: tr('The customer is coming'), arrived: tr('The customer is here'), on_time: tr('The customer will come at his time'), late: tr('The customer is late, on his way'), more_time: tr('The customer needs more time') }[order.pickupIntent.kind]}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{flow.dayTime(order.pickupIntent.at)}</Text>
                    </Card>
                ) : null}

                {order.undo ? (
                    <Card>
                        <Button label={`${tr('Undo')}: ${tr(order.undo.label)}`} icon="arrow-undo" kind="ghost" busy={undoing} onPress={undoLast} />
                        <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('Went wrong? Take the last step back. The history keeps a note.')}</Text>
                    </Card>
                ) : null}

                {order.kitchen?.problem?.at || (order.orderType === 'delivery' && order.kitchen?.readyAt) ? (
                    <Card tone={order.kitchen?.problem?.at ? warn : undefined}>
                        {order.kitchen?.problem?.at ? (
                            <Text style={{ color: warn, fontWeight: '800' }}>{tr('The kitchen says')}: {order.kitchen.problem.kind === 'out_of_stock' ? tr('a dish is finished') : order.kitchen.problem.kind === 'cannot_make' ? tr('it cannot be made') : order.kitchen.problem.note}{order.kitchen.problem.byName ? ` · ${order.kitchen.problem.byName}` : ''}</Text>
                        ) : null}
                        {order.kitchen?.problem?.at && !order.kitchen.problem.handledAt ? <View style={{ marginTop: 10 }}><KitchenProblemActions order={order} onDone={() => load()} /></View> : null}
                        {order.kitchen?.problem?.handledAt ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('You dealt with this')}: {order.kitchen.problem.handledAction === 'tell' ? tr('customer told') : order.kitchen.problem.handledAction === 'cancel' ? tr('order cancelled') : tr('left as it is')}</Text> : null}
                        {order.orderType === 'delivery' && order.kitchen?.readyAt ? <Text style={{ color: ok, fontWeight: '800', marginTop: order.kitchen?.problem?.at ? 6 : 0 }}>{tr('Food is packed')} · {flow.dayTime(order.kitchen.readyAt)}{order.kitchen.readyByName ? ` · ${order.kitchen.readyByName}` : ''}</Text> : null}
                    </Card>
                ) : null}

                <SectionTitle title={tr('What happened')} />
                <Card>
                    {/* every step has its colour (green for good news, amber for a wait, red for a problem), never grey */}
                    {timeline(order).map((h, i, arr) => (
                        <View key={i} style={{ flexDirection: 'row', paddingBottom: i === arr.length - 1 ? 0 : 12 }}>
                            <View style={{ alignItems: 'center', marginRight: 10 }}>
                                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tones[h.tone] || ok, marginTop: 4 }} />
                                {i !== arr.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: alpha(tones[h.tone] || ok, 0.35), marginTop: 2 }} /> : null}
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{tr(h.label)}</Text>
                                <Text style={{ color: muted, fontSize: 12 }}>{flow.dayTime(h.at)}{h.by ? tr(' · by {v1}', { v1: h.by }) : ''}</Text>
                                {h.note ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{h.note}</Text> : null}
                            </View>
                        </View>
                    ))}
                </Card>

                {order.delivery?.proof?.url ? (
                    <>
                        <SectionTitle title={tr('Photo of the delivery')} />
                        <Card>
                            <Pressable onPress={() => setViewing(order.delivery.proof.url)} accessibilityRole="button" accessibilityLabel={tr('Open the photo')}>
                                <Image source={{ uri: order.delivery.proof.url }} style={{ width: '100%', height: 200, borderRadius: 14 }} contentFit="cover" />
                            </Pressable>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('Taken by the delivery partner at the door')}{order.delivery.proof.at ? ' · ' + flow.dayTime(order.delivery.proof.at) : ''}. {tr('Tap the photo to see it big.')}</Text>
                        </Card>
                    </>
                ) : null}
                <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />

                {order.status === 'delivered' ? (
                    <Card>
                        <Button label={tr('Invoice (PDF)')} icon="document-text" kind="ghost" busy={invoiceBusy} onPress={() => openInvoice(order, setInvoiceBusy)} />
                    </Card>
                ) : null}

                {flow.canMarkUndelivered(order) ? (
                    <Card>
                        <Text style={{ color: muted, fontSize: 12, marginBottom: 8 }}>{order.orderType === 'pickup' ? tr('The customer did not come for this order.') : tr('The rider could not deliver this order.')}</Text>
                        <Button label={order.orderType === 'pickup' ? tr('Mark as not collected') : tr('Mark as not delivered')} icon="close-circle-outline" kind="ghost" onPress={() => actions.requestUndeliver(order)} />
                    </Card>
                ) : (order.orderType === 'delivery' && !flow.isFinal(order.status) && undeliveredWait !== null && undeliveredWait > 0) ? (
                    <Card>
                        <Text style={{ color: muted, fontSize: 12 }}>{tr('The rider reported a problem. You can mark this order as not delivered in {v1} (15 minutes after the first problem).', { v1: flow.mmss(undeliveredWait) })}</Text>
                    </Card>
                ) : null}
            </ScrollView>

            {/* the buttons that move the order on: always in reach */}
            {next ? (
                <View onLayout={(e) => setDockH(Math.ceil(e.nativeEvent.layout.height))} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, backgroundColor: background, borderTopWidth: 1, borderTopColor: alpha(muted, 0.25) }}>
                    {order.orderType === 'delivery' && order.status === 'preparing' && order.foodReady === false ? (
                        <>
                            <Text style={{ color: warn, fontWeight: '800', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{tr('The food is not ready yet. It cannot go out until it is.')}</Text>
                            <Button label={tr('Food is ready')} icon="checkmark-done" busy={busy} onPress={() => actions.foodReady(order)} style={{ marginBottom: 8 }} />
                        </>
                    ) : null}
                    {flow.needsRider(order, next) ? (
                        <Text style={{ color: warn, fontWeight: '800', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{tr('Assign a delivery partner first. Then you can send it out.')}</Text>
                    ) : null}
                    {flow.riderHandles(order, next) ? (
                        <Text style={{ color: muted, fontWeight: '700', fontSize: 13, marginBottom: 8, textAlign: 'center' }}>{next === 'out_for_delivery' ? tr('The delivery partner will collect it. Nothing to do.') : tr('On the way. The delivery partner will finish it.')}</Text>
                    ) : null}
                    <View style={{ flexDirection: 'row' }}>
                        {isNew && flow.canCancel(order) ? (
                            <Button label={tr('Reject')} icon="close" iconOnly kind="ghost" disabled={busy} onPress={() => actions.requestReject(order)} style={{ width: 54 }} />
                        ) : null}
                        <Button label={flow.riderHandles(order, next) ? (next === 'out_for_delivery' ? tr('I handed it over myself') : tr('Mark delivered myself')) : flow.stepLabel(order, next)} icon="checkmark" kind={flow.riderHandles(order, next) ? 'ghost' : 'primary'} busy={busy} disabled={flow.needsRider(order, next) || (order.orderType === 'delivery' && order.status === 'preparing' && order.foodReady === false && next === 'out_for_delivery')} onPress={() => actions.advance(order)} style={{ flex: 1, marginLeft: isNew && flow.canCancel(order) ? 8 : 0 }} />
                        {!isNew && flow.canCancel(order) ? (
                            <Button label={tr('Cancel this order')} icon="close" iconOnly kind="ghost" disabled={busy} onPress={() => actions.requestReject(order)} style={{ width: 54, marginLeft: 8 }} />
                        ) : null}
                    </View>
                </View>
            ) : null}

            <RiderSheet order={{ ...order, delivery: { ...(order.delivery || {}), riderId } }} visible={riderOpen} onClose={() => setRiderOpen(false)} onChanged={load} />
            {actions.sheets}
        </View>
    );
}
