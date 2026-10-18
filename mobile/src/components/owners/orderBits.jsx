// Pieces of the owner's order screens: the order card (with Accept / Reject right on it), the status pills, the
// countdown to the automatic cancel, the reason sheets (reject, "not delivered"), the rider sheet, and opening the invoice.
// What buttons an order shows comes from the SERVER (order.allowedNext), so the app can never offer a step it would refuse.
import React, { useEffect, useState } from 'react';
import { View, Text, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import api from '../../api/common/client';
import { useBrand } from '../common/kit';
import { Card, Pill, Button, Sheet, Field, Option, money } from './ui';
import { useNow } from '../../hooks/owners/useNow';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useOrdersStore } from '../../store/owners/useOrdersStore';
import { setOrderStatus, fetchRiders, assignRider, unassignRider, apiError } from '../../api/owners/shopApi';
import { acknowledge } from '../../utils/owners/soundbox';
import { showToast } from '../customers/shop';
import * as flow from '../../utils/owners/orderFlow';
import { ListShimmer } from './shimmer';
import { tr } from '../../i18n';

/* ------------------------------ small labels ------------------------------ */
export function useToneColors() {
    const { primary, ok, error, accent } = useBrand();
    return { warn: accent || '#F59E0B', info: primary, ok, bad: error };
}

export function StatusPill({ status }) {
    const tones = useToneColors();
    return <Pill label={flow.statusLabel(status)} color={tones[flow.statusTone(status)]} />;
}

export function PayBadge({ order }) {
    const { ok, accent } = useBrand();
    const paid = flow.isPaid(order);
    return <Pill label={flow.isCod(order) ? tr('COD') : paid ? tr('Paid') : tr('Not paid')} color={paid ? ok : (accent || '#F59E0B')} icon={paid ? 'checkmark-circle' : 'cash-outline'} />;
}

// "Cancels in 6:42": the server cancels an order nobody accepts. Turns red in the last 3 minutes.
export function Countdown({ until, compact }) {
    const { error, muted } = useBrand();
    const now = useNow(1000, true);
    if (!until) return null;
    const left = new Date(until).getTime() - now;
    const late = left <= 3 * 60000;
    const color = late ? error : muted;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="timer-outline" size={compact ? 14 : 16} color={color} style={{ marginRight: 4 }} />
            <Text style={{ color, fontSize: compact ? 12 : 13, fontWeight: '800' }}>
                {left > 0 ? tr('Cancels in {v1} if not accepted', { v1: flow.mmss(left) }) : tr('Cancelling now')}
            </Text>
        </View>
    );
}

/* ------------------------------ the order card ------------------------------ */
export function OrderCard({ order, onOpen, onAdvance, onReject, busy }) {
    const { text, muted, accent } = useBrand();
    const now = useNow(30000, true);
    const isNew = order.status === 'placed';
    const next = flow.forwardStep(order);
    const warn = accent || '#F59E0B';
    return (
        <Card onPress={onOpen} tone={isNew ? warn : undefined} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={{ color: text, fontSize: 17, fontWeight: '900', marginRight: 8 }}>#{order.orderNo}</Text>
                <View style={{ marginRight: 6 }}><Pill label={flow.typeLabel(order.orderType)} color={muted} /></View>
                <PayBadge order={order} />
                <View style={{ flex: 1 }} />
                <StatusPill status={order.status} />
            </View>

            <Text style={{ color: text, marginTop: 8, fontSize: 14 }} numberOfLines={2}>{flow.itemsSummary(order)}</Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <Text style={{ color: muted, fontSize: 12, flex: 1 }} numberOfLines={1}>
                    {order.customer?.name || tr('Customer')} · {flow.ago(order.createdAt, now)}
                </Text>
                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{money(order.pricing?.total)}</Text>
            </View>

            {order.scheduledFor ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                    <Ionicons name="calendar-outline" size={14} color={muted} style={{ marginRight: 4 }} />
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('For {v1}', { v1: flow.dayTime(order.scheduledFor) })}</Text>
                </View>
            ) : null}

            {isNew && order.acceptBy ? <View style={{ marginTop: 8 }}><Countdown until={order.acceptBy} compact /></View> : null}

            {isNew && next ? (
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    {flow.canCancel(order) ? <Button label={tr('Reject')} kind="ghost" icon="close" onPress={() => onReject(order)} disabled={busy} style={{ flex: 1, marginRight: 8 }} /> : null}
                    <Button label={tr('Accept')} icon="checkmark" busy={busy} onPress={() => onAdvance(order)} style={{ flex: 1.4 }} />
                </View>
            ) : null}
            {!isNew && next ? (
                <Button label={flow.stepLabel(order, next)} busy={busy} onPress={() => onAdvance(order)} style={{ marginTop: 12 }} />
            ) : null}
        </Card>
    );
}

/* ------------------------------ doing things to an order ------------------------------ */
// Accept / next step, reject, not delivered. Returns the sheets to draw once per screen.
//   onChanged(order)  the server's new version of the order, so the screen can show it at once
export function useOrderActions({ onChanged } = {}) {
    const [busyId, setBusyId] = useState(null);
    const [rejecting, setRejecting] = useState(null);       // the order being rejected
    const [undelivering, setUndelivering] = useState(null);

    const done = (updated) => {
        useOrdersStore.getState().patch(updated);
        useOwnerStore.getState().refresh();
        if (onChanged) onChanged(updated);
    };
    const fail = (e) => { useOwnerStore.getState().noteError(e); showToast(apiError(e)); };

    const advance = async (order) => {
        const next = flow.forwardStep(order);
        if (!next) return;
        setBusyId(order.id);
        try {
            const updated = await setOrderStatus(order.id, { status: next });
            if (next === 'accepted') acknowledge(order.id);   // he dealt with it: the ringing stops
            done(updated);
            showToast(tr('Order #{orderNo}: {v2}', { orderNo: order.orderNo, v2: flow.statusLabel(next) }));
        } catch (e) { fail(e); } finally { setBusyId(null); }
    };

    const submit = async (order, status, reasonCode, note) => {
        setBusyId(order.id);
        try {
            const updated = await setOrderStatus(order.id, { status, reasonCode, ...(note ? { note } : {}) });
            acknowledge(order.id);
            done(updated);
            setRejecting(null); setUndelivering(null);
            showToast(tr('Order #{orderNo}: {v2}', { orderNo: order.orderNo, v2: flow.statusLabel(status) }));
        } catch (e) { fail(e); } finally { setBusyId(null); }
    };

    const sheets = (
        <>
            <ReasonSheet
                visible={!!rejecting}
                title={rejecting ? tr('Reject order #{orderNo}', { orderNo: rejecting.orderNo }) : ''}
                intro={tr('Choose a reason. The customer is told the order was cancelled.')}
                reasons={flow.CANCEL_REASONS}
                needsText="other"
                textLabel={tr('Write the reason')}
                submitLabel={tr('Reject order')}
                busy={busyId !== null && !!rejecting && busyId === rejecting.id}
                onClose={() => setRejecting(null)}
                onSubmit={(code, note) => submit(rejecting, 'cancelled', code, note)}
            />
            <ReasonSheet
                visible={!!undelivering}
                title={undelivering ? tr('Order #{orderNo} not delivered', { orderNo: undelivering.orderNo }) : ''}
                intro={tr('Who was at fault? This decides who bears the cost.')}
                reasons={flow.UNDELIVERED_WHO}
                submitLabel={tr('Mark not delivered')}
                busy={busyId !== null && !!undelivering && busyId === undelivering.id}
                onClose={() => setUndelivering(null)}
                onSubmit={(code, note) => submit(undelivering, 'undelivered', code, note)}
            />
        </>
    );

    return { busyId, advance, requestReject: setRejecting, requestUndeliver: setUndelivering, sheets };
}

// Pick one reason; for the reason named in `needsText` (or any, optionally) he types his own words.
export function ReasonSheet({ visible, title, intro, reasons, needsText, textLabel, submitLabel, busy, onClose, onSubmit }) {
    const { muted } = useBrand();
    const [code, setCode] = useState(null);
    const [note, setNote] = useState('');
    useEffect(() => { if (visible) { setCode(null); setNote(''); } }, [visible]);

    const mustType = code && code === needsText;
    const ok = !!code && (!mustType || note.trim().length >= flow.MIN_REASON_LENGTH);
    const label = reasons.find((r) => r[0] === code)?.[1];

    return (
        <Sheet visible={visible} onClose={onClose} title={title}>
            {intro ? <Text style={{ color: muted, marginBottom: 6 }}>{intro}</Text> : null}
            {reasons.map(([id, text], i) => (
                <Option key={id} selected={code === id} title={text} last={i === reasons.length - 1} onPress={() => setCode(id)} />
            ))}
            {code ? (
                <View style={{ marginTop: 12 }}>
                    <Field
                        value={note}
                        onChangeText={setNote}
                        multiline
                        autoFocus={!!mustType}
                        maxLength={200}
                        placeholder={mustType ? tr('{v1} (at least {MIN_REASON_LENGTH} letters)', { v1: textLabel || 'Write the reason', MIN_REASON_LENGTH: flow.MIN_REASON_LENGTH }) : tr('Add a note (optional)')}
                    />
                </View>
            ) : null}
            <Button
                label={submitLabel}
                kind="danger"
                busy={busy}
                disabled={!ok}
                onPress={() => onSubmit(code, note.trim() || (mustType ? undefined : label))}
                style={{ marginTop: 14 }}
            />
        </Sheet>
    );
}

/* ------------------------------ riders ------------------------------ */
// Pick a rider for an order, let the app pick (auto), or take the rider off. Changing or removing needs a reason.
export function RiderSheet({ order, visible, onClose, onChanged }) {
    const { muted, ok, text, border } = useBrand();
    const [riders, setRiders] = useState(null);
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const has = !!order?.delivery?.riderId;

    useEffect(() => {
        if (!visible) return;
        setReason(''); setRiders(null);
        fetchRiders().then((r) => setRiders((r.items || []).filter((x) => x.isActive))).catch(() => setRiders([]));
    }, [visible]);

    const needReason = has && reason.trim().length < flow.MIN_REASON_LENGTH;

    const run = async (fn) => {
        if (needReason) { showToast(tr('Write why you are changing the rider')); return; }
        setBusy(true);
        try {
            await fn();
            showToast(tr('Done'));
            onChanged && onChanged();
            onClose();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };

    const sorted = (riders || []).slice().sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || a.activeOrderCount - b.activeOrderCount);

    return (
        <Sheet visible={visible} onClose={onClose} title={has ? tr('Change the rider') : tr('Choose a rider')}>
            {has ? (
                <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: muted, marginBottom: 6 }}>{tr('This order already has a rider. Say why you are changing it.')}</Text>
                    <Field value={reason} onChangeText={setReason} placeholder={tr('Reason (at least 3 letters)')} maxLength={150} />
                </View>
            ) : null}

            <Button label={tr('Let the app choose (ask all free riders)')} icon="flash" busy={busy} onPress={() => run(() => assignRider(order.id, { auto: true, ...(has ? { reason: reason.trim() } : {}) }))} />

            <Text style={{ color: muted, fontWeight: '800', fontSize: 12, marginTop: 16, marginBottom: 4 }}>{tr('YOUR RIDERS')}</Text>
            {riders === null ? <ListShimmer count={3} rows /> : null}
            {riders && !riders.length ? <Text style={{ color: muted, paddingVertical: 10 }}>{tr('You have no active riders. Add one in the Riders tab.')}</Text> : null}
            {sorted.map((r, i) => (
                <View key={r.userId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i === sorted.length - 1 ? 0 : 1, borderBottomColor: border }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.isOnline ? ok : muted, marginRight: 10 }} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: text, fontWeight: '800' }} numberOfLines={1}>{r.name || r.phone || tr('Rider')}</Text>
                        <Text style={{ color: muted, fontSize: 12 }}>{tr('{v1} · {activeOrderCount} order{v3} now', { v1: r.isOnline ? 'Online' : 'Offline', activeOrderCount: r.activeOrderCount, v3: r.activeOrderCount === 1 ? '' : 's' })}</Text>
                    </View>
                    <Button label={tr('Assign')} kind="ghost" disabled={busy || String(r.userId) === String(order?.delivery?.riderId)} onPress={() => run(() => assignRider(order.id, { riderId: r.userId, ...(has ? { reason: reason.trim() } : {}) }))} />
                </View>
            ))}

            {has ? (
                <Button label={tr('Take the rider off this order')} kind="ghost" icon="remove-circle-outline" disabled={busy} onPress={() => run(() => unassignRider(order.id, reason.trim()))} style={{ marginTop: 16 }} />
            ) : null}
        </Sheet>
    );
}

/* ------------------------------ phone, maps, invoice ------------------------------ */
export const callPhone = (phone) => { if (phone) Linking.openURL(`tel:${phone}`).catch(() => showToast(tr('Could not open the phone'))); };
export const whatsApp = (phone) => {
    const n = String(phone || '').replace(/\D/g, '');
    if (n.length >= 10) Linking.openURL(`https://wa.me/${n.length === 10 ? `91${n}` : n}`).catch(() => showToast(tr('Could not open WhatsApp')));
};
export function openMap(lat, lng, label) {
    const q = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat},${lng}` : encodeURIComponent(label || '');
    if (!q) return;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => showToast(tr('Could not open the map')));
}
export const addressLine = (a = {}) => [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ');

// The invoice PDF opens in the phone's PDF viewer (the server only makes it once the order is delivered).
export async function openInvoice(order, setBusy) {
    if (setBusy) setBusy(true);
    try {
        const res = await api.get(`/shop/orders/${order.id}/invoice`, { responseType: 'arraybuffer' });
        const file = new File(Paths.cache, `invoice-${order.orderNo}.pdf`);
        if (file.exists) file.delete();
        file.create();
        file.write(new Uint8Array(res.data));
        if (Platform.OS === 'android') {
            try {
                await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: file.contentUri, type: 'application/pdf', flags: 1 });
                return;
            } catch (e) { /* no PDF viewer: share it instead */ }
        }
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: `Invoice ${order.orderNo}` });
        else showToast(tr('No app on this phone can open a PDF'));
    } catch (e) {
        showToast(e?.response?.status === 409 ? tr('The invoice is ready after delivery') : tr('Could not get the invoice'));
    } finally { if (setBusy) setBusy(false); }
}

