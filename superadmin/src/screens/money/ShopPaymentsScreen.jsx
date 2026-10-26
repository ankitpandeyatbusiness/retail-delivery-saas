import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, Chip, SectionTitle, KeyValue, Stat } from '../../components/ui';
import { Segmented, Field } from '../../components/inputs';
import { Switch, Hint, Label } from '../../components/settingsForm';
import { Hero, SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import {
    paymentStatus, savePaymentKeys, newWebhookSecret, testPayments, setPaymentsEnabled,
    paymentReport, listRefunds, listDisputes, addDisputeNote,
} from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateTime, dateOnly, titleCase } from '../../utils/format';

const STEP = {
    keys_saved: 'Razorpay keys saved',
    connection_tested: 'Connection tested',
    webhook_secret_created: 'Webhook secret created',
    webhook_event_received: 'Webhook event received',
    enabled: 'Online payments switched on',
};
const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const REFUND_TONE = { pending: 'warn', processing: 'info', processed: 'success', failed: 'danger' };
const DISPUTE_TONE = { created: 'warn', under_review: 'info', action_required: 'danger', won: 'success', lost: 'danger', closed: 'neutral' };

// A shop's online payments: set up Razorpay, see the money, refunds, and chargebacks.
export default function ShopPaymentsScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [tab, setTab] = useState('setup');
    const [st, setSt] = useState(null);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);       // keys | secret
    const [keys, setKeys] = useState({ keyId: '', keySecret: '', ack: false });
    const [needAck, setNeedAck] = useState(false);
    const [secret, setSecret] = useState(null);
    const [busy, setBusy] = useState('');
    const [confirm, setConfirm] = useState(null);
    const [days, setDays] = useState(30);
    const [report, setReport] = useState(null);
    const [refunds, setRefunds] = useState(null);
    const [disputes, setDisputes] = useState(null);
    const [noteFor, setNoteFor] = useState(null);
    const [noteText, setNoteText] = useState('');

    const loadStatus = useCallback(async () => {
        try { setSt(await paymentStatus(shopId)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useEffect(() => { loadStatus(); }, [loadStatus]);

    useEffect(() => {
        if (tab === 'money') {
            setReport(null);
            const to = new Date();
            paymentReport(shopId, { from: ymd(new Date(to.getTime() - (days - 1) * 86400000)), to: ymd(to) }).then(setReport).catch((e) => toast(errMsg(e), 'error'));
        }
        if (tab === 'refunds') { setRefunds(null); listRefunds(shopId, {}).then((r) => setRefunds(r.items)).catch((e) => { setRefunds([]); toast(errMsg(e), 'error'); }); }
        if (tab === 'disputes') { setDisputes(null); listDisputes(shopId).then((r) => setDisputes(r.items)).catch((e) => { setDisputes([]); toast(errMsg(e), 'error'); }); }
    }, [tab, days, shopId]);

    const act = async (key, fn, ok) => {
        setBusy(key);
        try { const r = await fn(); if (ok) toast(ok); await loadStatus(); return r; } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(''); }
    };

    if (!st) return <Screen title="Online payments" subtitle={name}>{error ? <ErrorBox message={error} onRetry={loadStatus} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const done = st.checklist.filter((c) => c.done).length;
    const modeTone = st.keyMode === 'live' ? 'success' : 'warn';

    return (
        <Screen title="Online payments" subtitle={name} refreshing={false} onRefresh={loadStatus}>
            <Segmented
                value={tab}
                onChange={setTab}
                options={[{ value: 'setup', label: 'Setup' }, { value: 'money', label: 'Money' }, { value: 'refunds', label: 'Refunds' }, { value: 'disputes', label: 'Disputes' }]}
            />

            {tab === 'setup' ? (
                <>
                    <View style={{ marginTop: spacing.lg }}>
                        <Hero
                            section={st.enabled ? 'money' : 'platform'}
                            title={st.enabled ? 'Online payments are ON' : 'Online payments are OFF'}
                            subtitle={`${done} of ${st.checklist.length} steps done`}
                            right={st.keyMode ? <Badge label={st.keyMode === 'live' ? 'Live keys' : 'Test keys'} tone={modeTone} /> : null}
                        >
                            {st.warnings?.length ? st.warnings.map((w) => (
                                <Text key={w} style={{ color: t.warn, fontSize: font.sm, marginTop: spacing.sm }}>• {w}</Text>
                            )) : null}
                        </Hero>
                    </View>

                    <SectionTitle section="money">Steps</SectionTitle>
                    <Card>
                        {st.checklist.map((c, i) => (
                            <View key={c.step} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                                <Icon name={c.done ? 'ok' : 'clock'} size={22} color={c.done ? t.success : t.muted} filled={c.done} />
                                <Text style={{ flex: 1, marginLeft: spacing.md, color: t.text, fontWeight: c.done ? '700' : '500' }}>{STEP[c.step] || titleCase(c.step)}</Text>
                            </View>
                        ))}
                    </Card>

                    <SectionTitle section="settings">Actions</SectionTitle>
                    <Card>
                        <KeyValue label="Key ID" value={st.keyId} />
                        <KeyValue label="Last tested" value={st.verifiedAt ? dateTime(st.verifiedAt) : 'Not yet'} />
                        <KeyValue label="Last webhook" value={st.lastWebhookAt ? dateTime(st.lastWebhookAt) : 'None yet'} last />
                        <View style={{ height: spacing.md }} />
                        <Button title={st.keyId ? 'Change Razorpay keys' : 'Save Razorpay keys'} icon="key" kind="soft" onPress={() => { setKeys({ keyId: '', keySecret: '', ack: false }); setNeedAck(false); setSheet('keys'); }} />
                        <Button title="Create webhook secret" icon="lock" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => setConfirm('secret')} />
                        <Button title="Test the connection" icon="bolt" kind="outline" style={{ marginTop: spacing.sm }} loading={busy === 'test'} disabled={!st.hasKeySecret} onPress={() => act('test', () => testPayments(shopId), 'Connection works').catch(() => { })} />
                    </Card>

                    <SectionTitle section="alerts">Switch</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <Switch
                            title="Take online payments"
                            subtitle="Needs keys, a passed test and a webhook secret"
                            value={st.enabled}
                            onValueChange={(v) => act('enable', () => setPaymentsEnabled(shopId, v), v ? 'Online payments are on' : 'Online payments are off').catch(() => { })}
                            disabled={busy === 'enable'}
                            last
                        />
                    </Card>
                    <Hint>Webhook address: {st.webhookUrl}</Hint>
                </>
            ) : null}

            {tab === 'money' ? (
                <>
                    <View style={{ height: 52, marginTop: spacing.md }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                            {[7, 30, 90].map((d) => <Chip key={d} label={`${d} days`} active={days === d} onPress={() => setDays(d)} />)}
                        </ScrollView>
                    </View>
                    {!report ? <SkeletonList count={2} avatar={false} /> : (
                        <>
                            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                                <Stat section="money" label="Came in" value={rupeesFromPaise(report.captured.paise)} icon="rupee" />
                                <Stat section={report.netPaise >= 0 ? 'shops' : 'alerts'} label="Kept by the shop" value={rupeesFromPaise(report.netPaise)} icon="wallet" />
                            </View>
                            <Card style={{ marginTop: spacing.md, paddingVertical: 0 }}>
                                <KeyValue label={`Payments received (${report.captured.count})`} value={rupeesFromPaise(report.captured.paise)} />
                                <KeyValue label={`Refunded (${report.refunded.count})`} value={`− ${rupeesFromPaise(report.refunded.paise)}`} />
                                <KeyValue label={`Chargebacks lost (${report.disputesLost.count})`} value={`− ${rupeesFromPaise(report.disputesLost.paise)}`} />
                                <KeyValue label={`Refunds on the way (${report.refundsOnTheWay.count})`} value={rupeesFromPaise(report.refundsOnTheWay.paise)} />
                                <KeyValue label="Refunds that failed" value={String(report.refundsFailed)} />
                                <KeyValue label="Chargebacks waiting for an answer" value={String(report.disputesOpen)} last />
                            </Card>
                        </>
                    )}
                </>
            ) : null}

            {tab === 'refunds' ? (
                <View style={{ marginTop: spacing.lg }}>
                    {refunds === null ? <SkeletonList count={3} avatar={false} /> : !refunds.length ? <Empty icon="receipt" title="No refunds" hint="Refunds of online payments appear here." /> : refunds.map((r) => (
                        <Card key={String(r.id)} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ color: t.text, fontWeight: '800' }}>Order #{r.orderNo ?? '—'}</Text>
                                <Text style={{ color: t.text, fontWeight: '800' }}>{rupeesFromPaise(r.amountPaise)}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
                                <Badge label={titleCase(r.status)} tone={REFUND_TONE[r.status] || 'neutral'} />
                                <Badge label={titleCase(r.reason || '')} />
                                <Text style={{ color: t.muted, fontSize: font.xs }}>{dateOnly(r.createdAt)}</Text>
                            </View>
                        </Card>
                    ))}
                </View>
            ) : null}

            {tab === 'disputes' ? (
                <View style={{ marginTop: spacing.lg }}>
                    {disputes === null ? <SkeletonList count={3} avatar={false} /> : !disputes.length ? <Empty icon="shield" title="No chargebacks" hint="When a customer's bank questions a payment, it appears here." /> : disputes.map((d) => (
                        <Card key={String(d.id)} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Text style={{ color: t.text, fontWeight: '800' }}>Order #{d.orderNo ?? '—'}</Text>
                                <Text style={{ color: t.text, fontWeight: '800' }}>{rupeesFromPaise(d.amountPaise)}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                                <Badge label={titleCase(d.status)} tone={DISPUTE_TONE[d.status] || 'neutral'} />
                                {d.reasonCode ? <Badge label={titleCase(d.reasonCode)} /> : null}
                                {d.respondBy ? <Badge label={`Reply by ${dateOnly(d.respondBy)}`} tone="warn" icon="clock" /> : null}
                            </View>
                            {d.notes?.length ? (
                                <View style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt }}>
                                    {d.notes.map((n, i) => <Text key={i} style={{ color: t.text, fontSize: font.sm, marginBottom: 4 }}>• {n.text} <Text style={{ color: t.muted }}>({n.by}, {dateOnly(n.at)})</Text></Text>)}
                                </View>
                            ) : null}
                            <Button title="Add an evidence note" kind="soft" small icon="notes" style={{ marginTop: spacing.md }} onPress={() => { setNoteText(''); setNoteFor(d); }} />
                        </Card>
                    ))}
                </View>
            ) : null}

            <Sheet visible={sheet === 'keys'} onClose={() => setSheet(null)} title="Razorpay keys">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>From the shop's own Razorpay account (Settings, API keys). The secret is saved encrypted and can never be read back.</Text>
                <Field label="Key ID" value={keys.keyId} onChangeText={(v) => setKeys({ ...keys, keyId: v.trim() })} autoCapitalize="none" placeholder="rzp_live_xxxxxxxx" />
                <Field label="Key secret" value={keys.keySecret} onChangeText={(v) => setKeys({ ...keys, keySecret: v.trim() })} autoCapitalize="none" secureTextEntry />
                {st.enabled ? <Hint tone="warn">Online payments are on. Switch them off first, then change the keys.</Hint> : null}
                <Button
                    title={needAck ? 'Save the keys anyway' : 'Save keys'}
                    kind={needAck ? 'danger' : 'primary'}
                    loading={busy === 'keys'}
                    disabled={st.enabled}
                    style={{ marginTop: spacing.md }}
                    onPress={async () => {
                        setBusy('keys');
                        try {
                            await savePaymentKeys(shopId, { keyId: keys.keyId, keySecret: keys.keySecret, ...(needAck ? { acknowledgeOpenMoney: true } : {}) });
                            toast('Keys saved. Test the connection next.'); setSheet(null); setNeedAck(false); await loadStatus();
                        } catch (e) {
                            const m = errMsg(e);
                            if (/acknowledgeOpenMoney|Wait until it is finished/i.test(m)) setNeedAck(true);
                            toast(m, 'error');
                        } finally { setBusy(''); }
                    }}
                />
                {needAck ? <Hint tone="warn">Some online money is still on its way. Changing the keys now can make those refunds or payments hard to follow. Wait, or save anyway if you are sure.</Hint> : null}
            </Sheet>

            <ConfirmSheet
                visible={confirm === 'secret'}
                onClose={() => setConfirm(null)}
                title="Create a new webhook secret?"
                message="It is shown ONLY ONCE. If payments are already on, webhooks fail until the new secret is pasted into the shop's Razorpay dashboard."
                confirmLabel="Create"
                onConfirm={async () => { const r = await act('secret', () => newWebhookSecret(shopId), 'Secret created'); setSecret(r); setSheet('secret'); }}
            />

            <Sheet visible={sheet === 'secret'} onClose={() => setSheet(null)} title="Webhook secret">
                {secret ? (
                    <>
                        <Text style={{ color: t.warn, fontWeight: '800', marginBottom: spacing.md }}>Copy these now. The secret is not shown again.</Text>
                        <Label>Webhook URL</Label>
                        <Text selectable style={{ color: t.text, marginBottom: spacing.md }}>{secret.webhookUrl}</Text>
                        <Label>Secret</Label>
                        <Text selectable style={{ color: t.text, fontWeight: '800', fontSize: font.lg, marginBottom: spacing.md }}>{secret.secret}</Text>
                        <Label>Events to tick in Razorpay</Label>
                        <Text selectable style={{ color: t.muted, fontSize: font.sm }}>{[...(secret.events || []), ...(secret.disputeEvents || [])].join('\n')}</Text>
                        <Button title="Done" kind="outline" onPress={() => { setSecret(null); setSheet(null); }} style={{ marginTop: spacing.lg }} />
                    </>
                ) : null}
            </Sheet>

            <Sheet visible={!!noteFor} onClose={() => setNoteFor(null)} title="Evidence note">
                <Field label="What to remember for this chargeback" value={noteText} onChangeText={setNoteText} multiline maxLength={500} />
                <Button
                    title="Save note"
                    loading={busy === 'note'}
                    disabled={!noteText.trim()}
                    onPress={async () => {
                        setBusy('note');
                        try {
                            await addDisputeNote(shopId, noteFor.id, noteText.trim());
                            toast('Note saved'); setNoteFor(null);
                            setDisputes((await listDisputes(shopId)).items);
                        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
                    }}
                />
            </Sheet>
        </Screen>
    );
}
