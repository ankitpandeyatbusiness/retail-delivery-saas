// One complaint: what the customer wrote (and photos), then your answer: just a reply, a full or part refund, or no refund.
// The customer is told by notification. Opened with params { complaint }.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Button, Pill, SectionTitle, Chips, Field, Empty } from '../../components/owners/ui';
import { FormShimmer } from '../../components/owners/shimmer';
import { FormPage, Group, Hint, Label } from '../../components/owners/menuBits';
import { fetchOrder, fetchComplaint, updateComplaint, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { COMPLAINT_TYPES, RESOLUTION_TEXT } from '../../utils/owners/hubRules';
import { toPaise, ago, rupees } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

const CHOICES = [['none', 'Reply only'], ['refund_full', 'Full refund'], ['refund_partial', 'Part refund'], ['no_refund', 'No refund']];

const clock = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const metres = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

// What the system knew about the delivery when the customer said "I did not get it". Plain lines, red when it is a warning.
function EvidenceCard({ e }) {
    const { text, muted, error, ok } = useBrand();
    const who = e.markedBy === 'rider' ? (e.riderName || 'The rider') : e.markedBy === 'owner' ? 'You (the shop)' : 'The platform';
    const lines = [
        [`${who} marked it delivered · ${e.deliveredAt ? clock(e.deliveredAt) : ''}`, text],
        e.confirmedBy === 'pin' ? ["The customer's PIN was entered", ok]
            : e.confirmedBy === 'photo' ? ['A photo of the food handed over was taken', ok]
                : e.confirmedBy === 'shop' ? ['The shop completed this delivery, so no PIN or photo was needed', muted]
                    : ['No PIN and no photo for this delivery', error],
        e.spot ? (e.spot.noGps ? ["The rider's phone sent no location", error]
            : e.spot.far ? [`The rider was ${metres(e.spot.distanceM)} from the customer's pin`, error]
                : [`The rider was ${metres(e.spot.distanceM)} from the customer's pin`, ok]) : null,
        e.collectedAt || e.arrivedAt ? [[e.collectedAt && `Collected ${clock(e.collectedAt)}`, e.arrivedAt && `arrived ${clock(e.arrivedAt)}`].filter(Boolean).join(' · '), muted] : null,
        e.payment?.cashPaise ? [`Cash order: the rider collected ${rupees(e.payment.cashPaise)}`, muted] : null,
        e.priorClaims > 0 ? [`This customer said "not received" ${e.priorClaims} time${e.priorClaims === 1 ? '' : 's'} before (${e.priorRefused} refused)`, e.priorClaims >= 2 ? error : muted] : null,
    ].filter(Boolean);
    return (
        <>
            <SectionTitle title={tr('What we know about the delivery')} />
            <Card>
                {lines.map(([line, color], i) => <Text key={i} style={{ color, fontWeight: i === 0 ? '800' : '600', marginTop: i ? 8 : 0, lineHeight: 20 }}>{line}</Text>)}
                {e.proofUrl ? <Image source={{ uri: e.proofUrl }} style={{ width: 120, height: 120, borderRadius: 12, marginTop: 12 }} contentFit="cover" /> : null}
            </Card>
        </>
    );
}

// Opened from the list (the complaint is given) or from a notification (only its id).
export default function OwnerComplaintScreen() {
    const { complaint, id } = useRoute().params || {};
    const [c, setC] = useState(complaint || null);
    const [err, setErr] = useState('');
    useEffect(() => {
        if (complaint || !id) return;
        fetchComplaint(id).then(setC).catch((e) => setErr(apiError(e, 'Could not open this complaint.')));
    }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (!c) return <FormPage title={tr('Complaint')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;
    return <ComplaintView c0={c} />;
}

function ComplaintView({ c0 }) {
    const nav = useNavigation();
    const { text, muted, error, ok } = useBrand();
    const [c, setC] = useState(c0);
    const [order, setOrder] = useState(null);
    const [choice, setChoice] = useState('none');
    const [reply, setReply] = useState('');
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [fault, setFault] = useState('no');   // not received only: was the rider at fault?

    useEffect(() => { fetchOrder(c0.orderId).then(setOrder).catch(() => { }); }, [c0.orderId]);

    const done = c.status === 'resolved';
    // the tip is never refunded on a delivered order: what can be given back is the total without it
    const cap = order?.pricing ? Math.max(0, Math.round(((order.pricing.total || 0) - (order.pricing.tip || 0)) * 100)) : null;
    const online = order?.payment?.method && order.payment.method !== 'cod' && order.payment.status === 'paid';
    const refunds = choice === 'refund_full' || choice === 'refund_partial';
    const paise = toPaise(amount);
    const needReply = choice === 'none' || choice === 'no_refund';
    const valid = (!needReply || reply.trim().length >= 1) && (choice !== 'refund_partial' || (paise && (cap == null || paise <= cap)));

    const submit = async () => {
        setBusy(true);
        try {
            const body = { ownerReply: reply.trim() || undefined, resolution: choice };
            if (choice === 'refund_partial') body.refundPaise = paise;
            if (c.type === 'not_received') body.riderFault = fault === 'yes';
            const r = await updateComplaint(c.id, body);
            setC(r);
            showToast(r.status === 'resolved' ? tr('Decision sent to the customer') : tr('Reply sent'));
            if (r.status === 'resolved') nav.goBack();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <FormPage title={tr('Complaint · #{orderNo}', { orderNo: c.orderNo })} footer={!done ? <Button label={refunds ? tr('Send decision') : choice === 'no_refund' ? tr('Send decision') : tr('Send reply')} icon="send" disabled={!valid} busy={busy} onPress={submit} /> : null}>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }}>{COMPLAINT_TYPES[c.type] || c.type}</Text>
                    {done ? <Pill label={RESOLUTION_TEXT[c.resolution] || tr('Decided')} color={ok} /> : null}
                </View>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{c.customerName || tr('Customer')} · {ago(c.createdAt)}</Text>
                <Text style={{ color: text, marginTop: 10, lineHeight: 21 }}>{c.text}</Text>
                {c.photos?.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                        {c.photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 120, height: 120, borderRadius: 12, marginRight: 8 }} contentFit="cover" />)}
                    </ScrollView>
                ) : null}
                <View style={{ marginTop: 12 }}><Button label={tr('Open order #{orderNo}', { orderNo: c.orderNo })} icon="receipt" kind="ghost" onPress={() => nav.navigate('OwnerOrder', { id: String(c.orderId) })} /></View>
            </Card>

            {c.evidence ? <EvidenceCard e={c.evidence} /> : null}

            {done ? (
                <>
                    <SectionTitle title={tr('Your answer')} />
                    <Card>
                        <Text style={{ color: text, fontWeight: '800' }}>{c.autoReason ? tr('Closed by itself') : RESOLUTION_TEXT[c.resolution]}{c.refundPaise ? ` · ${rupees(c.refundPaise)}` : ''}</Text>
                        {c.autoReason ? <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{tr('24 hours passed since you replied, so this was closed. No refund was given.')}</Text> : null}
                        {c.ownerReply ? <Text style={{ color: muted, marginTop: 6 }}>“{c.ownerReply}”</Text> : null}
                        {c.type === 'not_received' && c.riderFault != null ? <Text style={{ color: c.riderFault ? error : muted, fontSize: 12, marginTop: 6 }}>{c.riderFault ? tr('You marked the rider as at fault.') : tr('You marked the rider as not at fault.')}</Text> : null}
                        {c.refundStatus === 'pending' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The refund is on its way to the customer.')}</Text> : null}
                        {c.refundStatus === 'failed' ? <Text style={{ color: error, fontSize: 12, marginTop: 6 }}>{tr('The online refund did not go through. Please contact support.')}</Text> : null}
                        {c.refundStatus === 'noted' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('This was a cash order: the refund is only noted here. Give the money back to the customer yourself.')}</Text> : null}
                    </Card>
                </>
            ) : (
                <Group title={tr('Your answer')} hint={c.ownerReply ? tr('Earlier reply: “{ownerReply}”', { ownerReply: c.ownerReply }) : tr('The customer gets your answer as a notification.')}>
                    <Label>{tr('What do you decide')}</Label>
                    <Chips options={CHOICES} value={choice} onChange={setChoice} style={{ marginTop: 0 }} />
                    {choice === 'refund_full' && cap != null ? <Hint>{tr('The customer gets {rupees} back (the order without the tip).', { rupees: rupees(cap) })}</Hint> : null}
                    {choice === 'refund_partial' ? (
                        <View style={{ marginTop: 6 }}>
                            <Label hint={cap != null ? tr('Up to {rupees}', { rupees: rupees(cap) }) : undefined}>{tr('Refund amount (₹)')}</Label>
                            <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 8))} placeholder={tr('e.g. 50')} keyboardType="decimal-pad" maxLength={8} />
                            {paise && cap != null && paise > cap ? <Hint tone="warn">{tr('That is more than the order allows.')}</Hint> : null}
                        </View>
                    ) : null}
                    {refunds && order ? <Hint>{online ? tr('This order was paid online: the money goes back to the customer automatically.') : tr('This was a cash order: the refund is only noted. Give the money back yourself.')}</Hint> : null}
                    {c.type === 'not_received' && choice !== 'none' ? (
                        <View style={{ marginTop: 12 }}>
                            <Label>{tr('Was the rider at fault?')}</Label>
                            <Chips options={[['no', tr('No')], ['yes', tr('Yes')]]} value={fault} onChange={setFault} style={{ marginTop: 0 }} />
                            {fault === 'yes' ? <Hint>{tr('It is counted on the rider\'s page. For a cash order, use Correction there if he should pay the money back.')}</Hint> : null}
                        </View>
                    ) : null}
                    <View style={{ height: 12 }} />
                    <Label>{needReply ? tr('Message to the customer') : tr('Message to the customer (optional)')}</Label>
                    <Field value={reply} onChangeText={setReply} multiline maxLength={500} placeholder={choice === 'no_refund' ? tr('Tell him why there is no refund') : tr('Write a short, kind reply')} />
                </Group>
            )}
        </FormPage>
    );
}
