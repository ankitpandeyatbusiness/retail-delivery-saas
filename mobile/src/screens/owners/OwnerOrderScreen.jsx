// One order, everything about it: the items, the bill, the customer, the address, the rider, the timeline, and the
// buttons to move it on. Opening it silences the new-order alert for it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Button, Pill, Empty, money } from '../../components/owners/ui';
import {
    StatusPill, PayBadge, Countdown, RiderSheet, useOrderActions, callPhone, whatsApp, openMap, addressLine, openInvoice,
} from '../../components/owners/orderBits';
import { fetchOrder, fetchDelivery, fetchRiders } from '../../api/owners/shopApi';
import { onOrderUpdate } from '../../api/common/socket';
import { acknowledge } from '../../utils/owners/soundbox';
import { useNow } from '../../hooks/owners/useNow';
import * as flow from '../../utils/owners/orderFlow';
import { FormShimmer } from '../../components/owners/shimmer';
import RiderLiveMap from '../../components/owners/RiderLiveMap';

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
    const [order, setOrder] = useState(null);
    const [delivery, setDelivery] = useState(null);
    const [riders, setRiders] = useState([]);
    const [failed, setFailed] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [riderOpen, setRiderOpen] = useState(false);
    const [invoiceBusy, setInvoiceBusy] = useState(false);
    const now = useNow(1000, true);
    const alive = useRef(true);

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
        return () => { alive.current = false; off(); };
    }, [id, load]);

    const actions = useOrderActions({ onChanged: (o) => { setOrder(o); load(); } });

    const pull = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (failed && !order) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title="Order" />
                <Empty icon="alert-circle-outline" title="Could not open this order" hint="Check your connection and try again." />
                <View style={{ paddingHorizontal: 16 }}><Button label="Try again" onPress={load} /></View>
            </View>
        );
    }
    if (!order) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title="Order" />
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
            <PageHeader title={`Order #${order.orderNo}`} right={<StatusPill status={order.status} />} />

            <ScrollView
                contentContainerStyle={{ paddingBottom: 150 }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} />}
            >
                {isNew && order.acceptBy ? (
                    <Card tone={warn} style={{ marginTop: 6 }}>
                        <Countdown until={order.acceptBy} />
                        <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>Accept or reject before the time runs out. Otherwise the order is cancelled and the customer is refunded.</Text>
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
                    {order.scheduledFor ? <View style={{ marginBottom: 6 }}><Pill label={`For ${flow.dayTime(order.scheduledFor)}`} color={warn} icon="calendar-outline" /></View> : null}
                </View>
                <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginBottom: 8 }}>
                    Placed {flow.dayTime(order.createdAt)} · {flow.ago(order.createdAt, now)}
                </Text>

                <SectionTitle title={`Items (${flow.itemCount(order)})`} />
                <Card>
                    {(order.items || []).map((l, i) => (
                        <View key={i} style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: i === order.items.length - 1 ? 0 : 1, borderBottomColor: alpha(muted, 0.25) }}>
                            <Text style={{ color: text, fontWeight: '900', width: 38, fontSize: 15 }}>{l.measure?.label ? '' : `${l.quantity}×`}</Text>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{l.measure?.label ? `${l.measure.label} ` : ''}{l.name}</Text>
                                {(l.selections || []).length ? (
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{l.selections.map((x) => x.name).join(' · ')}</Text>
                                ) : null}
                                {l.note ? <Text style={{ color: warn, fontSize: 12, fontWeight: '700', marginTop: 2 }}>Note: {l.note}</Text> : null}
                            </View>
                            <Text style={{ color: text, fontWeight: '700', marginLeft: 8 }}>{money(l.lineTotal)}</Text>
                        </View>
                    ))}
                    {order.note ? (
                        <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: alpha(warn, 0.14) }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 12 }}>CUSTOMER'S INSTRUCTIONS</Text>
                            <Text style={{ color: text, marginTop: 2 }}>{order.note}</Text>
                        </View>
                    ) : null}
                </Card>

                <SectionTitle title="Bill" />
                <Card>
                    <Line label="Items" value={money(p.subtotal)} />
                    {p.packagingCharge ? <Line label="Packaging" value={money(p.packagingCharge)} /> : null}
                    {p.deliveryFee ? <Line label="Delivery fee" value={money(p.deliveryFee)} /> : null}
                    {p.discount ? <Line label={p.couponCode ? `Discount (${p.couponCode})` : 'Discount'} value={`− ${money(p.discount)}`} color={ok} /> : null}
                    {p.tax ? <Line label={`Tax${p.taxMode === 'inclusive' ? ' (included)' : ''}`} value={money(p.tax)} /> : null}
                    {p.tip ? <Line label="Tip for the rider" value={money(p.tip)} /> : null}
                    <View style={{ height: 1, backgroundColor: alpha(muted, 0.3), marginVertical: 6 }} />
                    <Line label="Total" value={money(p.total)} bold />
                    <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{flow.paymentLabel(order)}</Text>
                </Card>

                <SectionTitle title="Customer" />
                <Card>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{order.customer?.name || 'Customer'}</Text>
                    {order.customer?.phone ? <Text style={{ color: muted, marginTop: 2 }}>{order.customer.phone}</Text> : null}
                    {order.customer?.phone && !order.customer?.deleted ? (
                        <View style={{ flexDirection: 'row', marginTop: 10 }}>
                            <Button label="Call" icon="call" kind="ghost" onPress={() => callPhone(order.customer.phone)} style={{ flex: 1, marginRight: 8 }} />
                            <Button label="WhatsApp" icon="logo-whatsapp" kind="ghost" onPress={() => whatsApp(order.customer.phone)} style={{ flex: 1 }} />
                        </View>
                    ) : null}
                    {order.orderType === 'dine_in' && order.tableNo ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                            <Ionicons name="restaurant-outline" size={18} color={muted} style={{ marginRight: 8 }} />
                            <Text style={{ color: text, fontWeight: '800' }}>Table {order.tableNo}</Text>
                        </View>
                    ) : null}
                    {order.orderType === 'delivery' && order.address ? (
                        <View style={{ marginTop: 12 }}>
                            <View style={{ flexDirection: 'row' }}>
                                <Ionicons name="location-outline" size={18} color={muted} style={{ marginRight: 8, marginTop: 1 }} />
                                <Text style={{ color: text, flex: 1 }}>{addressLine(order.address)}</Text>
                            </View>
                            <Button
                                label="Open in Maps"
                                icon="navigate"
                                kind="ghost"
                                onPress={() => openMap(order.address.latitude, order.address.longitude, addressLine(order.address))}
                                style={{ marginTop: 10 }}
                            />
                        </View>
                    ) : null}
                </Card>

                {showRider ? (
                    <>
                        <SectionTitle title="Delivery rider" />
                        <Card>
                            <Text style={{ color: text, fontWeight: '800' }}>{riderStatusText(delivery || order.delivery, rider)}</Text>
                            {rider?.phone ? <Text style={{ color: muted, marginTop: 2 }}>{rider.phone}</Text> : null}
                            {(delivery?.problems || []).map((pr, i) => (
                                <View key={i} style={{ flexDirection: 'row', marginTop: 8 }}>
                                    <Ionicons name="warning" size={16} color={error} style={{ marginRight: 6, marginTop: 1 }} />
                                    <Text style={{ color: error, flex: 1, fontSize: 13 }}>Rider reported: {String(pr.reason || '').replace(/_/g, ' ')}{pr.note ? ` (${pr.note})` : ''} · {flow.clockTime(pr.at)}</Text>
                                </View>
                            ))}
                            {rider?.phone ? (
                                <Button label="Call the rider" icon="call" kind="ghost" onPress={() => callPhone(rider.phone)} style={{ marginTop: 10 }} />
                            ) : null}
                            {order.status === 'out_for_delivery' && order.orderType === 'delivery' ? (
                                <RiderLiveMap orderId={String(order._id || order.id)} initial={rider?.lastLocation} destination={order.address} riderName={rider?.name} />
                            ) : null}
                            {order.status !== 'out_for_delivery' && rider?.lastLocation?.lat && rider?.lastLocation?.at && now - new Date(rider.lastLocation.at).getTime() < 5 * 60000 ? (
                                <Button label="See where the rider is" icon="locate" kind="ghost" onPress={() => openMap(rider.lastLocation.lat, rider.lastLocation.lng, rider.name)} style={{ marginTop: 8 }} />
                            ) : null}
                            {!flow.isFinal(order.status) ? (
                                <Button label={riderId ? 'Change or remove the rider' : 'Assign a rider'} icon="bicycle" onPress={() => setRiderOpen(true)} style={{ marginTop: 10 }} />
                            ) : null}
                        </Card>
                    </>
                ) : null}

                <SectionTitle title="What happened" />
                <Card>
                    {(order.statusHistory || []).slice().reverse().map((h, i, arr) => (
                        <View key={i} style={{ flexDirection: 'row', paddingBottom: i === arr.length - 1 ? 0 : 12 }}>
                            <View style={{ alignItems: 'center', marginRight: 10 }}>
                                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === 0 ? ok : muted, marginTop: 4 }} />
                                {i !== arr.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: alpha(muted, 0.3), marginTop: 2 }} /> : null}
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{flow.statusLabel(h.status)}</Text>
                                <Text style={{ color: muted, fontSize: 12 }}>
                                    {flow.dayTime(h.at)}{h.byType ? ` · by ${h.byType === 'owner' ? 'you' : h.byType}` : ''}
                                </Text>
                                {h.note ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{h.note}</Text> : null}
                            </View>
                        </View>
                    ))}
                </Card>

                {order.status === 'delivered' ? (
                    <Card>
                        <Button label="Invoice (PDF)" icon="document-text" kind="ghost" busy={invoiceBusy} onPress={() => openInvoice(order, setInvoiceBusy)} />
                    </Card>
                ) : null}

                {flow.canMarkUndelivered(order) ? (
                    <Card>
                        <Text style={{ color: muted, fontSize: 12, marginBottom: 8 }}>The rider could not deliver this order.</Text>
                        <Button label="Mark as not delivered" icon="close-circle-outline" kind="ghost" onPress={() => actions.requestUndeliver(order)} />
                    </Card>
                ) : (order.orderType === 'delivery' && !flow.isFinal(order.status) && undeliveredWait !== null && undeliveredWait > 0) ? (
                    <Card>
                        <Text style={{ color: muted, fontSize: 12 }}>
                            The rider reported a problem. You can mark this order as not delivered in {flow.mmss(undeliveredWait)} (15 minutes after the first problem).
                        </Text>
                    </Card>
                ) : null}
            </ScrollView>

            {/* the buttons that move the order on: always in reach */}
            {next ? (
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, backgroundColor: background, borderTopWidth: 1, borderTopColor: alpha(muted, 0.25) }}>
                    <View style={{ flexDirection: 'row' }}>
                        {isNew && flow.canCancel(order) ? (
                            <Button label="Reject" icon="close" kind="ghost" disabled={busy} onPress={() => actions.requestReject(order)} style={{ flex: 1, marginRight: 8 }} />
                        ) : null}
                        <Button label={flow.stepLabel(order, next)} icon="checkmark" busy={busy} onPress={() => actions.advance(order)} style={{ flex: isNew ? 1.4 : 1 }} />
                    </View>
                    {!isNew && flow.canCancel(order) ? (
                        <Button label="Cancel this order" kind="ghost" disabled={busy} onPress={() => actions.requestReject(order)} style={{ marginTop: 8 }} />
                    ) : null}
                </View>
            ) : null}

            <RiderSheet order={{ ...order, delivery: { ...(order.delivery || {}), riderId } }} visible={riderOpen} onClose={() => setRiderOpen(false)} onChanged={load} />
            {actions.sheets}
        </View>
    );
}
