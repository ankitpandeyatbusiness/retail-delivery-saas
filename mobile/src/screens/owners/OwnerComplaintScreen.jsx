// One complaint: what the customer wrote (and photos), then your answer: just a reply, a full or part refund, or no refund.
// The customer is told by notification. Opened with params { complaint }.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Button, Pill, SectionTitle, Chips, Field } from '../../components/owners/ui';
import { FormPage, Group, Hint, Label } from '../../components/owners/menuBits';
import { fetchOrder, updateComplaint, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { COMPLAINT_TYPES, RESOLUTION_TEXT } from '../../utils/owners/hubRules';
import { toPaise, ago, rupees } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';

const CHOICES = [['none', 'Reply only'], ['refund_full', 'Full refund'], ['refund_partial', 'Part refund'], ['no_refund', 'No refund']];

export default function OwnerComplaintScreen() {
    const nav = useNavigation();
    const { complaint: c0 } = useRoute().params || {};
    const { text, muted, error, ok } = useBrand();
    const [c, setC] = useState(c0);
    const [order, setOrder] = useState(null);
    const [choice, setChoice] = useState('none');
    const [reply, setReply] = useState('');
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);

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
            const r = await updateComplaint(c.id, body);
            setC(r);
            showToast(r.status === 'resolved' ? 'Decision sent to the customer' : 'Reply sent');
            if (r.status === 'resolved') nav.goBack();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <FormPage title={`Complaint · #${c.orderNo}`} footer={!done ? <Button label={refunds ? 'Send decision' : choice === 'no_refund' ? 'Send decision' : 'Send reply'} icon="send" disabled={!valid} busy={busy} onPress={submit} /> : null}>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }}>{COMPLAINT_TYPES[c.type] || c.type}</Text>
                    {done ? <Pill label={RESOLUTION_TEXT[c.resolution] || 'Decided'} color={ok} /> : null}
                </View>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{c.customerName || 'Customer'} · {ago(c.createdAt)}</Text>
                <Text style={{ color: text, marginTop: 10, lineHeight: 21 }}>{c.text}</Text>
                {c.photos?.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                        {c.photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 120, height: 120, borderRadius: 12, marginRight: 8 }} contentFit="cover" />)}
                    </ScrollView>
                ) : null}
                <View style={{ marginTop: 12 }}><Button label={`Open order #${c.orderNo}`} icon="receipt" kind="ghost" onPress={() => nav.navigate('OwnerOrder', { id: String(c.orderId) })} /></View>
            </Card>

            {done ? (
                <>
                    <SectionTitle title="Your answer" />
                    <Card>
                        <Text style={{ color: text, fontWeight: '800' }}>{RESOLUTION_TEXT[c.resolution]}{c.refundPaise ? ` · ${rupees(c.refundPaise)}` : ''}</Text>
                        {c.ownerReply ? <Text style={{ color: muted, marginTop: 6 }}>“{c.ownerReply}”</Text> : null}
                        {c.refundStatus === 'pending' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>The refund is on its way to the customer.</Text> : null}
                        {c.refundStatus === 'failed' ? <Text style={{ color: error, fontSize: 12, marginTop: 6 }}>The online refund did not go through. Please contact support.</Text> : null}
                        {c.refundStatus === 'noted' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>This was a cash order: the refund is only noted here. Give the money back to the customer yourself.</Text> : null}
                    </Card>
                </>
            ) : (
                <Group title="Your answer" hint={c.ownerReply ? `Earlier reply: “${c.ownerReply}”` : 'The customer gets your answer as a notification.'}>
                    <Label>What do you decide</Label>
                    <Chips options={CHOICES} value={choice} onChange={setChoice} style={{ marginTop: 0 }} />
                    {choice === 'refund_full' && cap != null ? <Hint>The customer gets {rupees(cap)} back (the order without the tip).</Hint> : null}
                    {choice === 'refund_partial' ? (
                        <View style={{ marginTop: 6 }}>
                            <Label hint={cap != null ? `Up to ${rupees(cap)}` : undefined}>Refund amount (₹)</Label>
                            <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 8))} placeholder="e.g. 50" keyboardType="decimal-pad" maxLength={8} />
                            {paise && cap != null && paise > cap ? <Hint tone="warn">That is more than the order allows.</Hint> : null}
                        </View>
                    ) : null}
                    {refunds && order ? <Hint>{online ? 'This order was paid online: the money goes back to the customer automatically.' : 'This was a cash order: the refund is only noted. Give the money back yourself.'}</Hint> : null}
                    <View style={{ height: 12 }} />
                    <Label>{needReply ? 'Message to the customer' : 'Message to the customer (optional)'}</Label>
                    <Field value={reply} onChangeText={setReply} multiline maxLength={500} placeholder={choice === 'no_refund' ? 'Tell him why there is no refund' : 'Write a short, kind reply'} />
                </Group>
            )}
        </FormPage>
    );
}
