import React, { useState } from 'react';
import { View, Text, Image, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, Badge } from '../../components/ui';
import { Hero } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { Choice, NumberField, Hint } from '../../components/settingsForm';
import { toast } from '../../components/feedback';
import { TYPE_NAME } from '../../components/ComplaintsList';
import { decideComplaint } from '../../api/opsApi';
import { errMsg } from '../../api/adminClient';
import { dateTime, rupees, titleCase } from '../../utils/format';

const DECISIONS = [
    { value: 'none', label: 'Reply only' },
    { value: 'refund_full', label: 'Full refund' },
    { value: 'refund_partial', label: 'Part refund' },
    { value: 'no_refund', label: 'No refund' },
];
const TONE = { open: 'danger', in_progress: 'warn', resolved: 'success' };

// One complaint: what the customer said, and (while it is not decided) the reply and refund decision.
export default function ComplaintDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, shopName, complaint: c0 } = useRoute().params;
    const [c, setC] = useState(c0);
    const [decision, setDecision] = useState('none');
    const [reply, setReply] = useState('');
    const [amount, setAmount] = useState(undefined);
    const [busy, setBusy] = useState(false);
    const decided = c.status === 'resolved';

    const submit = async () => {
        if (decision === 'none' && !reply.trim()) { toast('Write a reply or choose a decision', 'error'); return; }
        if (decision === 'no_refund' && !reply.trim()) { toast('Tell the customer why there is no refund', 'error'); return; }
        if (decision === 'refund_partial' && !(amount > 0)) { toast('Enter the refund amount', 'error'); return; }
        setBusy(true);
        try {
            const body = {
                ...(reply.trim() ? { ownerReply: reply.trim() } : {}),
                resolution: decision,
                ...(decision === 'refund_partial' ? { refundPaise: Math.round(amount * 100) } : {}),
            };
            const out = await decideComplaint(shopId, c.id, body);
            setC({ ...c, ...out });
            toast(decision === 'none' ? 'Reply sent' : 'Decision saved');
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen
            title={TYPE_NAME[c.type] || titleCase(c.type)}
            subtitle={`Order #${c.orderNo}${shopName ? ` · ${shopName}` : ''}`}
            footer={!decided ? <Button title={decision === 'none' ? 'Send reply' : 'Save decision'} icon="check" onPress={submit} loading={busy} /> : null}
        >
            <Hero
                section={decided ? 'money' : c.status === 'open' ? 'alerts' : 'catalog'}
                title={c.customerName || 'Customer'}
                subtitle={dateTime(c.createdAt)}
                right={<Badge label={titleCase(c.status)} tone={TONE[c.status]} />}
            >
                <Text style={{ color: t.text, fontSize: font.md, marginTop: spacing.md, lineHeight: 22 }}>{c.text}</Text>
            </Hero>

            {c.photos?.length ? (
                <>
                    <SectionTitle section="people">Photos</SectionTitle>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {c.photos.map((p) => <Image key={p} source={{ uri: p }} style={{ width: 150, height: 150, borderRadius: radius.md, marginRight: spacing.md, backgroundColor: t.surfaceAlt }} />)}
                    </ScrollView>
                </>
            ) : null}

            <Button
                title={`Open order #${c.orderNo}`}
                icon="orders"
                kind="outline"
                style={{ marginTop: spacing.lg }}
                onPress={() => nav.navigate('OrderDetail', { orderId: String(c.orderId), orderNo: c.orderNo })}
            />

            {c.ownerReply || decided || c.refundPaise ? (
                <>
                    <SectionTitle section="catalog">Decision so far</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Decision" value={titleCase(c.resolution || 'none')} />
                        <KeyValue label="Refund" value={c.refundPaise ? `${rupees(c.refundPaise / 100)}${c.refundStatus && c.refundStatus !== 'none' ? ` (${titleCase(c.refundStatus)})` : ''}` : 'None'} />
                        <KeyValue label="Decided" value={c.decidedAt ? dateTime(c.decidedAt) : null} />
                        <KeyValue label="Reply" value={c.ownerReply} last />
                    </Card>
                </>
            ) : null}

            {!decided ? (
                <>
                    <SectionTitle section="settings">Your answer</SectionTitle>
                    <Card>
                        <Choice label="Decision" options={DECISIONS} value={decision} onChange={setDecision} />
                        {decision === 'refund_partial' ? <NumberField label="Refund amount" prefix="₹" value={amount} onChange={setAmount} /> : null}
                        <Field label={decision === 'none' || decision === 'no_refund' ? 'Reply to the customer' : 'Reply (optional)'} value={reply} onChangeText={setReply} multiline maxLength={500} />
                        <Hint>
                            {decision === 'refund_full' ? 'The whole order (except the tip) is refunded. An online payment goes back automatically.'
                                : decision === 'none' ? 'The complaint stays "in progress" until you give a decision.'
                                    : 'The customer is told your answer.'}
                        </Hint>
                    </Card>
                </>
            ) : null}
        </Screen>
    );
}
