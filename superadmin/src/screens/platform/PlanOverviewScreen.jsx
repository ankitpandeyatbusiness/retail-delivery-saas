import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Badge, KeyValue } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ConfirmSheet, Empty, toast } from '../../components/feedback';
import { fetchPlanOverview, applyHeldPlanPayment } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

const rs = (paise) => `Rs ${((paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const NAMES = { growth: 'Growth', pro: 'Pro' };

// Where every shop stands on its plan, and the plan money that needs a look: plans ending within 7 days, ended and paused shops, payments that were held, bank disputes.
export default function PlanOverviewScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [o, setO] = useState(null);
    const [apply, setApply] = useState(null);

    const load = useCallback(() => { fetchPlanOverview().then(setO).catch((e) => { toast(errMsg(e), 'error'); setO({ counts: null, expiring: [], ended: [], held: [], disputes: [] }); }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const open = (id, name) => nav.navigate('ShopPlan', { shopId: id, name });
    const row = (r, tone) => (
        <Pressable key={r.id} onPress={() => open(r.id, r.name)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}>
            <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '700' }}>{r.name}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm }}>{NAMES[r.plan]} · {r.state === 'paused' ? 'paused' : r.endsAt ? `${r.state === 'ended' ? 'ended' : 'ends'} ${day(r.endsAt)}` : ''}</Text>
            </View>
            <Badge label={r.state === 'free' ? 'Free' : r.state === 'paused' ? 'Paused' : r.state === 'ended' ? 'Ended' : `${r.daysLeft}d left`} tone={tone} />
        </Pressable>
    );

    const c = o && o.counts;
    return (
        <Screen title="Plans overview" subtitle="Every shop on its plan">
            {!o ? <SkeletonList count={4} /> : (
                <>
                    {c ? (
                        <Card>
                            <KeyValue label="Shops" value={String(c.total)} />
                            <KeyValue label="Partner" value={String(c.partner)} />
                            <KeyValue label="Growth" value={`${c.growth.active} paid · ${c.growth.free} free · ${c.growth.ended + c.growth.paused} ended or paused`} />
                            <KeyValue label="Pro" value={`${c.pro.active} paid · ${c.pro.free} free · ${c.pro.ended + c.pro.paused} ended or paused`} />
                            <KeyValue label="No plan yet" value={String(c.none)} last />
                        </Card>
                    ) : null}

                    <SectionTitle section="money">Needs a look</SectionTitle>
                    {!o.held.length && !o.disputes.length ? <Card><Text style={{ color: t.muted }}>No held payments and no open bank disputes.</Text></Card> : null}
                    {o.held.map((h) => (
                        <Card key={h.id} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                                <Text style={{ color: t.text, fontWeight: '800', flex: 1 }}>{h.shop}</Text>
                                <Badge label="Held payment" tone="warn" />
                            </View>
                            <Text style={{ color: t.text }}>{rs(h.payablePaise)} for {NAMES[h.to] || h.to} x {h.months} month{h.months > 1 ? 's' : ''}, paid {day(h.at)}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.xs }}>{h.why || 'The shop changed after the owner saw the price.'}</Text>
                            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                                <Button title="Apply as the owner saw it" kind="soft" small onPress={() => setApply(h)} />
                                <Button title="Refund it" kind="outline" small onPress={() => nav.navigate('ShopRefund', { shopId: h.shopId })} />
                            </View>
                        </Card>
                    ))}
                    {o.disputes.map((d) => (
                        <Card key={d.id} style={{ marginBottom: spacing.md }} onPress={() => open(d.shopId, d.shop)}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                                <Text style={{ color: t.text, fontWeight: '800', flex: 1 }}>{d.shop}</Text>
                                <Badge label="Bank dispute" tone="danger" />
                            </View>
                            <Text style={{ color: t.text }}>{rs(d.amountPaise)} on a {d.kind === 'plan' ? 'plan payment' : d.kind === 'wallet' ? 'wallet top-up' : 'SMS top-up'} · {d.status.replace('_', ' ')}{d.respondBy ? ` · reply by ${day(d.respondBy)}` : ''}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.xs }}>Reply to the bank in the Razorpay dashboard. If it is lost, the wallet money or the plan is taken back for you.</Text>
                        </Card>
                    ))}

                    <SectionTitle section="settings">Ending within 7 days</SectionTitle>
                    <Card>{o.expiring.length ? o.expiring.map((r) => row(r, 'warn')) : <Text style={{ color: t.muted }}>No plan ends in the next 7 days.</Text>}</Card>

                    <SectionTitle section="settings">Ended or paused</SectionTitle>
                    <Card>{o.ended.length ? o.ended.map((r) => row(r, 'danger')) : <Text style={{ color: t.muted }}>No shop is waiting for a plan.</Text>}</Card>
                </>
            )}

            <ConfirmSheet
                visible={!!apply}
                onClose={() => setApply(null)}
                icon="checkmark-circle-outline"
                title="Apply this payment?"
                message={apply ? `${apply.shop}'s payment of ${rs(apply.payablePaise)} is applied as the owner saw it: ${NAMES[apply.to] || apply.to} for ${apply.months} month${apply.months > 1 ? 's' : ''}. The shop's plan changes now. If you would rather return the money, use Refund it.` : ''}
                confirmLabel="Apply it"
                onConfirm={async () => { try { await applyHeldPlanPayment(apply.id); toast('Payment applied'); load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setApply(null); } }}
            />
        </Screen>
    );
}
