import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Image, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, Badge, ListRow } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { Choice } from '../../components/settingsForm';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { StatusBadge, STATUS, ACTIVE, nextOf, payLabel, TYPE_LABEL } from '../../components/orderBits';
import Icon from '../../components/Icon';
import { getOrder, changeOrderStatus, shareInvoice, getDelivery, assignRider, unassignRider } from '../../api/ordersApi';
import { listRiders } from '../../api/opsApi';
import { errMsg } from '../../api/adminClient';
import { rupees, dateTime, titleCase } from '../../utils/format';

const CANCEL_REASONS = [
    { value: 'platform', label: 'Platform decision' },
    { value: 'shop_fault', label: 'Shop fault' },
    { value: 'customer_fault', label: 'Customer fault' },
];

function Money({ label, value, strong, last }) {
    const t = useTheme();
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
            <Text style={{ color: strong ? t.text : t.muted, fontWeight: strong ? '800' : '500', fontSize: strong ? font.lg : font.md }}>{label}</Text>
            <Text style={{ color: t.text, fontWeight: strong ? '800' : '600', fontSize: strong ? font.lg : font.md }}>{value}</Text>
        </View>
    );
}

// One order: where it stands, what to do next, who is delivering, what was ordered and paid.
export default function OrderDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { orderId, orderNo } = useRoute().params;
    const [o, setO] = useState(null);
    const [delivery, setDelivery] = useState(null);
    const [riders, setRiders] = useState(null);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);     // cancel | assign | unassign
    const [busy, setBusy] = useState('');
    const [cancel, setCancel] = useState({ reasonCode: 'platform', note: '' });
    const [reason, setReason] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [forceDeliver, setForceDeliver] = useState(false);
    const [advance, setAdvance] = useState(false);

    const load = useCallback(async () => {
        try {
            const order = await getOrder(orderId);
            setO(order);
            setError('');
            if (order.orderType === 'delivery') {
                getDelivery(order.tenantId, orderId).then(setDelivery).catch(() => setDelivery(null));
                listRiders(order.tenantId).then((r) => setRiders(r.items)).catch(() => setRiders([]));
            }
        } catch (e) { setError(errMsg(e)); }
    }, [orderId]);
    useEffect(() => { load(); }, [load]);
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!o) return <Screen title={`Order ${orderNo ? `#${orderNo}` : ''}`}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const active = ACTIVE.includes(o.status);
    const next = nextOf(o);
    const d = delivery?.delivery || o.delivery;
    const riderName = (id) => riders?.find((r) => String(r.userId) === String(id))?.name || 'Rider';
    const hasRider = !!d?.riderId && d.status !== 'rejected';
    const edgeTone = STATUS[o.status]?.edge;
    const heroSection = { info: 'people', primary: 'shops', warn: 'catalog', success: 'money', danger: 'alerts' }[edgeTone] || 'platform';

    const move = async (status, extra = {}) => {
        setBusy(status);
        try {
            const upd = await changeOrderStatus(orderId, { status, ...extra });
            setO(upd);
            toast(`Order is now ${STATUS[status]?.label?.toLowerCase() || status}`);
            if (upd.orderType === 'delivery') getDelivery(upd.tenantId, orderId).then(setDelivery).catch(() => { });
        } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(''); }
    };

    const assign = async (body) => {
        setBusy('assign');
        try {
            await assignRider(o.tenantId, orderId, { ...body, ...(hasRider ? { reason: reason.trim() } : {}) });
            toast('Rider assigned'); setSheet(null); setReason(''); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const invoice = async () => {
        setBusy('invoice');
        try { await shareInvoice(o); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not get the invoice'), 'error'); } finally { setBusy(''); }
    };

    return (
        <Screen title={`Order #${o.orderNo}`} subtitle={o.shopName} refreshing={refreshing} onRefresh={refresh}>
            <Hero
                section={heroSection}
                leading={<View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Icon name="orders" size={26} color={t.primary} /></View>}
                title={rupees(o.pricing?.total)}
                subtitle={`${TYPE_LABEL[o.orderType] || o.orderType} · ${dateTime(o.createdAt)}`}
                right={<StatusBadge status={o.status} />}
            >
                <Pressable onPress={() => nav.navigate('ShopsTab', { screen: 'ShopDetail', params: { shopId: o.tenantId, name: o.shopName } })} style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.md }}>
                    <Icon name="shops" size={18} color={t.primary} />
                    <Text style={{ color: t.primary, fontWeight: '800', marginLeft: 6 }}>{o.shopName}</Text>
                    <Icon name="next" size={16} color={t.primary} style={{ marginLeft: 4 }} />
                </Pressable>
            </Hero>

            {active ? (
                <>
                    <SectionTitle section="orders">What to do</SectionTitle>
                    <Card>
                        {next && next !== 'delivered' ? (
                            <Button title={`Move to "${STATUS[next]?.label}"`} icon="next" onPress={() => setAdvance(true)} loading={busy === next} />
                        ) : null}
                        {next === 'delivered' || (next && next !== 'delivered') ? (
                            <Button
                                title="Mark as delivered"
                                kind={next === 'delivered' ? 'primary' : 'soft'}
                                icon="ok"
                                style={{ marginTop: next && next !== 'delivered' ? spacing.sm : 0 }}
                                onPress={() => setForceDeliver(true)}
                                loading={busy === 'delivered'}
                            />
                        ) : null}
                        <Button title="Cancel this order" kind="dangerSoft" icon="block" style={{ marginTop: spacing.sm }} onPress={() => setSheet('cancel')} />
                        <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>
                            Superadmin can move an order one step forward, or force it to delivered or cancelled. The shop and the customer are told.
                        </Text>
                    </Card>
                </>
            ) : null}

            <SectionTitle section="people">Customer</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Name" value={o.customer?.name} />
                <KeyValue label="Phone" value={o.customer?.phone} />
                {o.tableNo ? <KeyValue label="Table" value={o.tableNo} /> : null}
                {o.scheduledFor ? <KeyValue label="Scheduled for" value={dateTime(o.scheduledFor)} /> : null}
                {o.pickupUntil ? <KeyValue label="Pickup until" value={dateTime(o.pickupUntil)} /> : null}
                {o.note ? <KeyValue label="Note" value={o.note} /> : null}
                <KeyValue label="Order type" value={TYPE_LABEL[o.orderType] || o.orderType} last />
            </Card>

            <SectionTitle section="catalog">Items ({o.items?.length || 0})</SectionTitle>
            <Card>
                {o.items?.map((it, i) => (
                    <View key={i} style={{ paddingVertical: spacing.sm, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Text style={{ color: t.text, fontWeight: '700', flex: 1, paddingRight: spacing.md }}>{it.quantity} × {it.name}</Text>
                            <Text style={{ color: t.text, fontWeight: '700' }}>{rupees(it.lineTotal)}</Text>
                        </View>
                        {it.selections?.length ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{it.selections.map((s) => s.name).join(', ')}</Text> : null}
                        {it.note ? <Text style={{ color: t.muted, fontSize: font.sm, fontStyle: 'italic' }}>“{it.note}”</Text> : null}
                    </View>
                ))}
            </Card>

            <SectionTitle section="money">Bill</SectionTitle>
            <Card>
                <Money label="Items" value={rupees(o.pricing?.subtotal)} />
                {o.pricing?.discount ? <Money label={`Discount${o.pricing.couponCode ? ` (${o.pricing.couponCode})` : ''}`} value={`− ${rupees(o.pricing.discount)}`} /> : null}
                {o.pricing?.deliveryFee ? <Money label="Delivery fee" value={rupees(o.pricing.deliveryFee)} /> : null}
                {o.pricing?.packagingCharge ? <Money label="Packaging" value={rupees(o.pricing.packagingCharge)} /> : null}
                {o.pricing?.tax ? <Money label={`GST${o.pricing.taxMode === 'inclusive' ? ' (included)' : ''}`} value={rupees(o.pricing.tax)} /> : null}
                {o.pricing?.tip ? <Money label="Tip" value={rupees(o.pricing.tip)} /> : null}
                <View style={{ height: 1, backgroundColor: t.border, marginVertical: spacing.sm }} />
                <Money label="Total" value={rupees(o.pricing?.total)} strong />
            </Card>

            <SectionTitle section="money">Payment</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Method" value={payLabel(o.payment)} />
                <KeyValue label="Status" value={titleCase(o.payment?.status || '')} />
                {o.payment?.paidAt ? <KeyValue label="Paid at" value={dateTime(o.payment.paidAt)} /> : null}
                {o.payment?.paymentId ? <KeyValue label="Payment id" value={o.payment.paymentId} /> : null}
                {o.billing?.billable !== undefined ? <KeyValue label="Counts for rent" value={o.billing.billable ? 'Yes' : 'No'} /> : null}
                <KeyValue label="Cancel / refund" value={o.cancel?.refundPaise ? `Refund ${rupees(o.cancel.refundPaise / 100)}` : null} last />
            </Card>

            {o.orderType === 'delivery' ? (
                <>
                    <SectionTitle section="riders">Delivery</SectionTitle>
                    <Card>
                        <Text style={{ color: t.text, fontWeight: '700' }}>{o.address?.name || o.customer?.name}</Text>
                        <Text style={{ color: t.muted, marginTop: 2 }}>
                            {[o.address?.line1, o.address?.line2, o.address?.landmark, o.address?.city, o.address?.pincode].filter(Boolean).join(', ')}
                        </Text>
                        <View style={{ height: 1, backgroundColor: t.border, marginVertical: spacing.md }} />
                        {hasRider ? (
                            <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{riderName(d.riderId)}</Text>
                                    <Badge label={titleCase(d.status || '')} tone={d.status === 'delivered' ? 'success' : d.status === 'picked_up' ? 'info' : 'warn'} />
                                </View>
                                {d.assignedAt ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>Assigned {dateTime(d.assignedAt)}</Text> : null}
                                {d.pickedUpAt ? <Text style={{ color: t.muted, fontSize: font.sm }}>Picked up {dateTime(d.pickedUpAt)}</Text> : null}
                                {d.deliveredAt ? <Text style={{ color: t.muted, fontSize: font.sm }}>Delivered {dateTime(d.deliveredAt)}</Text> : null}
                                {d.pinRequired ? <Text style={{ color: t.muted, fontSize: font.sm }}>Delivery PIN is required</Text> : null}
                            </>
                        ) : (
                            <Text style={{ color: t.muted }}>{d?.broadcast?.active ? 'Offered to all free riders, waiting for one to accept.' : 'No rider yet.'}</Text>
                        )}
                        {d?.problems?.length ? (
                            <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: t.warnSoft }}>
                                <Text style={{ color: t.warn, fontWeight: '800', marginBottom: 4 }}>Rider reported a problem</Text>
                                {d.problems.map((p, i) => <Text key={i} style={{ color: t.text, fontSize: font.sm }}>• {titleCase(p.reason || '')}{p.note ? ` — ${p.note}` : ''} ({dateTime(p.at)})</Text>)}
                            </View>
                        ) : null}
                        {d?.proof?.url ? (
                            <Pressable onPress={() => Linking.openURL(d.proof.url).catch(() => toast('Could not open the photo', 'error'))} style={{ marginTop: spacing.md }}>
                                <Text style={{ color: t.text, fontWeight: '800', marginBottom: 6 }}>Delivery photo (proof of safe delivery)</Text>
                                <Image source={{ uri: d.proof.url }} style={{ width: '100%', height: 200, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} resizeMode="cover" />
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 4 }}>Taken by the rider {dateTime(d.proof.at)} · tap to open</Text>
                            </Pressable>
                        ) : d?.deliveredAt || o.status === 'delivered' ? (
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>The rider did not add a delivery photo.</Text>
                        ) : null}
                        {active ? (
                            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                                <Button style={{ flex: 1 }} small kind="soft" icon="rider" title={hasRider ? 'Change rider' : 'Assign rider'} onPress={() => { setReason(''); setSheet('assign'); }} />
                                {hasRider ? <Button style={{ flex: 1 }} small kind="dangerSoft" title="Remove rider" onPress={() => { setReason(''); setSheet('unassign'); }} /> : null}
                            </View>
                        ) : null}
                    </Card>
                </>
            ) : null}

            {o.status === 'cancelled' || o.status === 'undelivered' ? (
                <>
                    <SectionTitle section="alerts">Why it stopped</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Stopped by" value={titleCase(o.cancelledBy || o.cancel?.by || o.undelivered?.by || '')} />
                        <KeyValue label="Reason" value={o.cancelReason || titleCase(o.cancel?.reasonCode || o.undelivered?.reasonCode || '')} />
                        {o.undelivered?.note ? <KeyValue label="Note" value={o.undelivered.note} /> : null}
                        <KeyValue label="Refund" value={(o.cancel?.refundPaise ?? o.undelivered?.refundPaise) ? rupees((o.cancel?.refundPaise ?? o.undelivered?.refundPaise) / 100) : 'None'} last />
                    </Card>
                </>
            ) : null}

            <SectionTitle section="platform">Timeline</SectionTitle>
            <Card>
                {(o.statusHistory || []).slice().reverse().map((h, i, a) => (
                    <View key={i} style={{ flexDirection: 'row', paddingBottom: i === a.length - 1 ? 0 : spacing.md }}>
                        <View style={{ alignItems: 'center', marginRight: spacing.md }}>
                            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: i === 0 ? t.primary : t.border, marginTop: 4 }} />
                            {i < a.length - 1 ? <View style={{ width: 2, flex: 1, backgroundColor: t.border }} /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: t.text, fontWeight: '700' }}>{STATUS[h.status]?.label || titleCase(h.status)}</Text>
                            <Text style={{ color: t.muted, fontSize: font.xs }}>
                                {dateTime(h.at)}{h.byType ? ` · ${titleCase(h.byType)}` : ''}
                            </Text>
                            {h.note ? <Text style={{ color: t.muted, fontSize: font.sm }}>{h.note}</Text> : null}
                        </View>
                    </View>
                ))}
            </Card>

            {o.status === 'delivered' ? (
                <Button title="Share invoice (PDF)" icon="receipt" kind="soft" style={{ marginTop: spacing.xl }} loading={busy === 'invoice'} onPress={invoice} />
            ) : null}

            <ConfirmSheet
                visible={advance}
                onClose={() => setAdvance(false)}
                title={`Move to "${STATUS[next]?.label}"?`}
                message="The shop and the customer are told about the new status."
                confirmLabel="Move forward"
                onConfirm={() => move(next)}
            />
            <ConfirmSheet
                visible={forceDeliver}
                onClose={() => setForceDeliver(false)}
                title="Mark as delivered?"
                message="Use this only when the food has really reached the customer. It cannot be undone."
                confirmLabel="Mark delivered"
                onConfirm={() => move('delivered')}
            />

            <Sheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} title="Cancel this order">
                <Choice label="Reason" options={CANCEL_REASONS} value={cancel.reasonCode} onChange={(v) => setCancel({ ...cancel, reasonCode: v })} />
                <Field label="Note (optional)" value={cancel.note} onChangeText={(v) => setCancel({ ...cancel, note: v })} maxLength={200} />
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>An online payment is refunded by the platform's rules for this reason.</Text>
                <Button
                    title="Cancel order"
                    kind="danger"
                    loading={busy === 'cancelled'}
                    onPress={async () => { try { await move('cancelled', { reasonCode: cancel.reasonCode, note: cancel.note.trim() || undefined }); setSheet(null); } catch (e) { /* shown */ } }}
                />
                <Button title="Keep the order" kind="outline" onPress={() => setSheet(null)} style={{ marginTop: spacing.sm }} />
            </Sheet>

            <Sheet visible={sheet === 'assign'} onClose={() => setSheet(null)} title={hasRider ? 'Change rider' : 'Assign a rider'}>
                {hasRider ? <Field label="Reason for changing" value={reason} onChangeText={setReason} maxLength={200} placeholder="e.g. Rider is not answering" /> : null}
                <Button title="Choose the best rider automatically" icon="sparkle" kind="soft" loading={busy === 'assign'} disabled={hasRider && !reason.trim()} onPress={() => assign({ auto: true })} />
                <Text style={{ color: t.text, fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm }}>Or pick one</Text>
                {riders === null ? <Text style={{ color: t.muted }}>Loading riders…</Text> : !riders.length ? <Text style={{ color: t.muted }}>This shop has no riders yet.</Text> : riders.map((r, i) => (
                    <ListRow
                        key={String(r.userId)}
                        section={r.isOnline ? 'riders' : 'platform'}
                        icon="rider"
                        title={r.name || r.phone || 'Rider'}
                        subtitle={`${r.isOnline ? 'Online' : 'Offline'} · ${r.activeOrderCount} active order${r.activeOrderCount === 1 ? '' : 's'}${r.isActive ? '' : ' · switched off'}`}
                        onPress={r.isActive && (!hasRider || reason.trim()) ? () => assign({ riderId: String(r.userId) }) : undefined}
                        last={i === riders.length - 1}
                    />
                ))}
            </Sheet>

            <ConfirmSheet
                visible={sheet === 'unassign'}
                onClose={() => setSheet(null)}
                title="Remove the rider?"
                message="The order goes back to waiting for a rider."
                confirmLabel="Remove rider"
                danger
                needReason
                onConfirm={async (r) => {
                    try { await unassignRider(o.tenantId, orderId, r); toast('Rider removed'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </Screen>
    );
}
