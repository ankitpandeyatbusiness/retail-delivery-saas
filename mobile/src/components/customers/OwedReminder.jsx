// A customer who left a table without paying is reminded EVERY time he opens the app (and when he comes back after a while),
// and cannot place any order until it is paid. He can call the shop, or say "I already paid" (the owner is asked to confirm).
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button } from '../owners/ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { useOwedPrompt } from '../../store/customers/useOwedPrompt';
import { claimPaid } from '../../api/customers/shopApi';
import { payOwed } from '../../utils/customers/payOwed';
import { onNotification } from '../../api/common/socket';
import { showToast } from './shop';
import { whereOf, WhereOf } from '../../utils/common/where';
import { tr } from '../../i18n';

export { useOwedPrompt };
const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const AWAY_MS = 3 * 60 * 1000;

export default function OwedReminder() {
    const { surface, text, muted, border, error } = useBrand();
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && ['rider', 'admin', 'kitchen', 'waiter'].indexOf(user.role) < 0;
    const owed = useTableBill((s) => s.bill?.owed);
    const open = useOwedPrompt((s) => s.open);
    const [busy, setBusy] = useState(false);
    const [paying, setPaying] = useState(false);
    const asked = useRef(false);
    const awayAt = useRef(0);

    // every visit: once when the app opens (when the bill has loaded)
    useEffect(() => {
        if (!owed) { asked.current = false; useOwedPrompt.getState().hide(); return; }
        if (enabled && !asked.current) { asked.current = true; if (!owed.claim) useOwedPrompt.getState().show(); }
    }, [enabled, !!owed]);   // eslint-disable-line react-hooks/exhaustive-deps
    // ...and again when he comes back after being away for a few minutes
    useEffect(() => {
        if (!enabled) return undefined;
        const sub = AppState.addEventListener('change', (st) => {
            if (st !== 'active') { awayAt.current = Date.now(); return; }
            if (awayAt.current && Date.now() - awayAt.current > AWAY_MS) {
                useTableBill.getState().load().then(() => { const o = useTableBill.getState().bill?.owed; if (o && !o.claim) useOwedPrompt.getState().show(); });
            }
        });
        // the shop's answer arrives while the app is open: say it
        const off = onNotification((n) => {
            if (n?.type === 'owed_cleared' || n?.type === 'owed_claim_rejected') { showToast(n.body || n.title); useTableBill.getState().load(); }
        });
        return () => { sub.remove(); off(); };
    }, [enabled]);

    if (!enabled || !owed) return null;
    const paid = async () => {
        setBusy(true);
        try { await claimPaid(); await useTableBill.getState().load(); showToast(tr('The shop has been told. They will confirm shortly.')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Please try again.')); } finally { setBusy(false); }
    };
    const payNow = async () => {
        setPaying(true);
        try {
            const r = await payOwed({ user });
            await useTableBill.getState().load();
            if (r.status === 'paid') { useOwedPrompt.getState().hide(); showToast(tr('Paid. Thank you! You can order again.')); }
            else showToast(tr(r.message || 'Payment not completed'));
        } finally { setPaying(false); }
    };
    return (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => useOwedPrompt.getState().hide()} statusBarTranslucent>
            <ScrollView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
                <View style={{ backgroundColor: surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: border }}>
                    <View style={{ alignItems: 'center' }}>
                        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: alpha(error, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="alert-circle" size={32} color={error} />
                        </View>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 19, marginTop: 12, textAlign: 'center' }}>{tr('Your bill is not paid')}</Text>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 28, marginTop: 6 }}>₹{Math.round(owed.amount)}</Text>
                        <Text style={{ color: muted, textAlign: 'center', marginTop: 4 }}>{tr('From {where}. It was not paid.', { where: whereOf(owed.table) })}</Text>
                    </View>
                    <Text style={{ color: text, textAlign: 'center', marginTop: 12, fontSize: 13.5 }}>{tr('Until it is paid you cannot order anything: delivery, pickup or dine in.')}</Text>
                    {owed.visits?.length ? (
                        <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: alpha(muted, 0.25), paddingTop: 8 }}>
                            <Text style={{ color: text, fontWeight: '900', marginBottom: 4 }}>{tr('What you ordered')}</Text>
                            <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                                {owed.visits.map((v, vi) => (
                                    <View key={vi}>
                                        {owed.visits.length > 1 ? <Text style={{ color: muted, fontWeight: '800', marginTop: 6 }}>{WhereOf(v.table)} · {hm(v.leftAt)}</Text> : null}
                                        {v.rounds.map((r, i) => (
                                            <View key={r.id} style={{ paddingVertical: 6 }}>
                                                <Text style={{ color: text, fontWeight: '800' }}>{tr('Round {n}', { n: i + 1 })} · {hm(r.at)} · {rs(r.total)}</Text>
                                                {r.items.map((it, k) => (
                                                    <View key={k}>
                                                        <Text style={{ color: muted, fontSize: 12.5 }}>{it.quantity}× {it.name}  ·  {rs(it.total)}</Text>
                                                        {it.addons?.length ? <Text style={{ color: muted, fontSize: 12 }}>   + {it.addons.join(', ')}</Text> : null}
                                                    </View>
                                                ))}
                                            </View>
                                        ))}
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    ) : null}
                    {owed.reply ? (
                        <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: alpha(error, 0.12) }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{tr('The shop says it did not receive your payment')}</Text>
                            {owed.reply.message ? <Text style={{ color: text, marginTop: 4 }}>“{owed.reply.message}”</Text> : null}
                        </View>
                    ) : null}
                    {owed.claim ? (
                        <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: alpha(muted, 0.14) }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{tr('The shop is checking your payment')}</Text>
                            <Text style={{ color: muted, marginTop: 2, fontSize: 12.5 }}>{tr('You will get an answer shortly.')}</Text>
                        </View>
                    ) : null}
                    <View style={{ marginTop: 16 }}>
                        {owed.canPay ? <Button label={tr('Pay ₹{n} now', { n: Math.round(owed.amount) })} icon="card" busy={paying} disabled={paying} onPress={payNow} style={{ minHeight: 60 }} /> : null}
                        {owed.phone ? <Button label={tr('Call the shop')} icon="call" kind={owed.canPay ? 'ghost' : 'primary'} onPress={() => Linking.openURL('tel:' + owed.phone)} style={{ marginTop: owed.canPay ? 10 : 0 }} /> : null}
                        {owed.claim ? null : <Button label={tr('I have already paid')} icon="checkmark-circle" kind="ghost" busy={busy} onPress={paid} style={{ marginTop: owed.phone || owed.canPay ? 10 : 0 }} />}
                        <Pressable onPress={() => useOwedPrompt.getState().hide()} hitSlop={8} style={{ alignItems: 'center', paddingTop: 14 }}>
                            <Text style={{ color: muted, fontWeight: '800' }}>{tr('Close')}</Text>
                        </Pressable>
                    </View>
                </View>
            </ScrollView>
        </Modal>
    );
}
