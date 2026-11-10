import React, { useCallback, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { useRoute, useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, Badge, Button, KeyValue } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { fetchShopRefunds, sendShopRefund } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';

const rs = (paise) => `Rs ${((paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const NAMES = { growth: 'Growth', pro: 'Pro' };
const newId = () => `rf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// EMERGENCY: send real money back to a shop's payment method (the unused part of a plan, the Partner wallet balance, the SMS balance).
// Only the supreme admin (the server refuses everyone else). It cannot be undone, every request needs a reason, and a double tap cannot send it twice.
export default function ShopRefundScreen() {
    const t = useTheme();
    const { shopId } = useRoute().params;
    const tenant = useShopStore((s) => s.byId[shopId])?.tenant;
    const [o, setO] = useState(null);
    const [ask, setAsk] = useState(null);   // { kind, sourceId, title, amount (rupees text), endPlan, canEnd, hint, requestId }
    const [reason, setReason] = useState('');
    const [sure, setSure] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => { fetchShopRefunds(shopId).then(setO).catch((e) => { toast(errMsg(e), 'error'); setO({ plan: [], history: [] }); }); }, [shopId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const open = (a) => { setReason(''); setAsk({ ...a, requestId: newId() }); };
    const paise = ask ? Math.round(Number(ask.amount || 0) * 100) : 0;

    const send = async () => {
        setBusy(true);
        try {
            const r = await sendShopRefund(shopId, { kind: ask.kind, sourceId: ask.sourceId, amountPaise: paise, endPlan: ask.endPlan, reason: reason.trim(), requestId: ask.requestId });
            toast(r.failed ? `${rs(r.cashPaise || 0)} sent, ${r.failed} part failed and the balance was put back` : 'Refund sent');
            setAsk(null); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); setSure(false); }
    };

    const wallets = o ? [['wallet', 'Partner wallet', o.wallet], ['sms', 'SMS balance', o.sms]].filter(([, , x]) => x) : [];
    return (
        <Screen title="Send money back" subtitle={tenant?.name ? `${tenant.name}. Emergency use only.` : 'Emergency use only.'}>
            <Card>
                <Text style={{ color: t.text, fontWeight: '800', marginBottom: spacing.xs }}>This sends real money to the shop's payment method.</Text>
                <Text style={{ color: t.muted }}>It cannot be undone. Only what the shop paid online can go back, never more than was paid. The refund reaches them in 5 to 7 working days. Ask your CA how to record the GST.</Text>
            </Card>

            {!o ? <SkeletonList count={3} /> : (
                <>
                    <SectionTitle section="money">Plan payments</SectionTitle>
                    {!o.plan.length ? <Card><Text style={{ color: t.muted }}>No online plan payments to refund.</Text></Card> : o.plan.map((p) => (
                        <Card key={p.id} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                                <Text style={{ color: t.text, fontWeight: '900', fontSize: font.md, flex: 1 }}>{NAMES[p.to] || p.to} x {p.months} month{p.months > 1 ? 's' : ''}</Text>
                                {p.status === 'held' ? <Badge label="Held" tone="warn" /> : p.current ? <Badge label="Running" tone="success" /> : null}
                            </View>
                            <KeyValue label="Paid" value={`${rs(p.payablePaise)} on ${day(p.paidAt)}`} />
                            <KeyValue label="Already refunded" value={rs(p.refundedPaise)} />
                            <KeyValue label="Can still be refunded" value={rs(p.refundablePaise)} last />
                            <Button title="Refund" kind="outline" small disabled={p.refundablePaise < 100} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                                onPress={() => open({ kind: 'plan', sourceId: p.id, title: `${NAMES[p.to] || p.to} plan payment`, amount: String((p.suggestedPaise || p.refundablePaise) / 100), canEnd: p.current && p.kind !== 'branch', endPlan: p.current && p.kind !== 'branch', max: p.refundablePaise, hint: p.suggestedPaise ? `Suggested: ${rs(p.suggestedPaise)}${p.current ? ' (the unused days)' : ''}` : '' })} />
                        </Card>
                    ))}

                    <SectionTitle section="money">Wallets</SectionTitle>
                    {wallets.map(([kind, label, x]) => (
                        <Card key={kind} style={{ marginBottom: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '900', fontSize: font.md, marginBottom: spacing.sm }}>{label}</Text>
                            <KeyValue label="Balance now" value={rs(x.balancePaise)} />
                            <KeyValue label="Paid for online (can go back)" value={rs(x.refundableBasePaise)} />
                            <KeyValue label="Goes to the shop, with GST" value={rs(x.estimatedCashPaise)} last />
                            <Button title="Refund the balance" kind="outline" small disabled={x.refundableBasePaise < 100} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                                onPress={() => open({ kind, title: label, amount: String(x.refundableBasePaise / 100), max: x.refundableBasePaise, hint: 'This is the wallet money. The shop gets it back plus the GST it paid on it.' })} />
                        </Card>
                    ))}

                    <SectionTitle section="money">History</SectionTitle>
                    {!o.history.length ? <Card><Text style={{ color: t.muted }}>No refunds yet.</Text></Card> : o.history.map((h) => (
                        <Card key={h.id} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ color: t.text, fontWeight: '800', flex: 1 }}>{rs(h.cashPaise)} · {h.kind === 'plan' ? 'Plan' : h.kind === 'wallet' ? 'Wallet' : 'SMS'}</Text>
                                <Badge label={h.status === 'processed' ? 'Sent' : h.status === 'failed' ? 'Failed' : 'Waiting'} tone={h.status === 'processed' ? 'success' : h.status === 'failed' ? 'danger' : 'warn'} />
                            </View>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.xs }}>{day(h.at)} · {h.by} · {h.reason}{h.endedPlan ? ' · plan ended' : ''}</Text>
                            {h.error ? <Text style={{ color: t.danger, fontSize: font.sm, marginTop: spacing.xs }}>{h.error}</Text> : null}
                        </Card>
                    ))}
                </>
            )}

            <Sheet visible={!!ask} onClose={() => setAsk(null)} title={ask ? `Refund: ${ask.title}` : ''}>
                {ask ? (
                    <>
                        <Field label={ask.kind === 'plan' ? 'Amount to send back (Rs, GST included)' : 'Wallet money to give back (Rs)'} hint={`${ask.hint || ''} Most you can enter: ${rs(ask.max)}.`.trim()}
                            value={ask.amount} onChangeText={(v) => setAsk({ ...ask, amount: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" />
                        {ask.canEnd ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
                                <Text style={{ color: t.text, flex: 1 }}>End the plan now (the shop must choose a plan again)</Text>
                                <Switch value={ask.endPlan} onValueChange={(v) => setAsk({ ...ask, endPlan: v })} />
                            </View>
                        ) : null}
                        <Field label="Reason (kept in the record)" placeholder="e.g. shop closing, owner asked, payment problem" value={reason} onChangeText={setReason} maxLength={300} />
                        <Button title={`Send ${paise ? rs(paise) : ''} back`.replace('  ', ' ')} kind="danger" onPress={() => setSure(true)} disabled={paise < 100 || paise > ask.max || reason.trim().length < 5} />
                    </>
                ) : null}
            </Sheet>
            <ConfirmSheet visible={sure} onClose={() => setSure(false)} icon="cash-outline" title="Send this money back?" confirmLabel={busy ? 'Sending...' : 'Yes, send it'} danger
                message={`${rs(paise)} ${ask?.kind === 'plan' ? '' : '(wallet money, plus GST goes to the payment method) '}will be refunded to the shop. This cannot be undone.${ask?.endPlan ? ' The plan ends now.' : ''}`}
                onConfirm={send} />
        </Screen>
    );
}
