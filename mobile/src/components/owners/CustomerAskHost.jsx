// What a customer asks the shop to decide, as a popup that comes up at once (and again whenever the app opens):
//   pickup, at his pickup time:  "I collected it" (cash: did he pay?)  |  "I do not want it" (how much to refund: Full, Half, 1/4th, None)
//   table:                       "please cancel the round that is being made"
// Every answer sends the customer a polite message; the owner can add his own words.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet } from './ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onNotification } from '../../api/common/socket';
import { fetchCustomerAsks, answerCustomerAsk, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const OPTS = [[100, 'Full'], [50, 'Half'], [25, '1/4th'], [0, 'None']];
const TYPES = ['pickup_collect_claim', 'pickup_not_wanted_claim', 'order_cancel_request'];

export default function CustomerAskHost() {
    const { text, muted, border, ok, primary, onPrimary, error } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const on = role === 'admin' && !customerView && access !== 'blocked';
    const [items, setItems] = useState([]);
    const [hidden, setHidden] = useState([]);
    const [msg, setMsg] = useState('');
    const [pct, setPct] = useState(null);
    const [busy, setBusy] = useState('');
    const load = useCallback(() => { fetchCustomerAsks().then((r) => setItems(r.items || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (!on) { setItems([]); return undefined; }
        load();
        const a = onNotification((n) => { if (n && TYPES.includes(n.type)) { setHidden([]); load(); } });
        const b = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => { a(); b.remove(); };
    }, [on, load]);

    const cur = on ? items.find((x) => !hidden.includes(x.id)) : null;
    useEffect(() => { setMsg(''); setPct(null); }, [cur?.id]);

    const send = async (key, body) => {
        setBusy(key);
        try {
            await answerCustomerAsk(cur.id, { ...body, message: msg.trim() });
            showToast(tr('Done. The customer is told politely.'));
            setItems((l) => l.filter((x) => x.id !== cur.id));
        } catch (e) { showToast(apiError(e)); if ([404, 409].includes(e?.response?.status)) load(); } finally { setBusy(''); }
    };

    const title = !cur ? '' : cur.kind === 'cancel' ? tr('Cancel this round?') : cur.kind === 'collected' ? tr('Did he collect it?') : tr('He does not want it');
    const owedIf = (p) => Math.round((cur.total * (100 - p)) / 100);
    return (
        <Sheet visible={!!cur} onClose={() => cur && setHidden((h) => [...h, cur.id])} title={title}>
            {cur ? (
                <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 17, flex: 1 }} numberOfLines={1}>{cur.customer.name || tr('Customer')} · #{cur.orderNo}{cur.table ? ` · ${tr('Table {t}', { t: cur.table })}` : ''}</Text>
                        {cur.customer.phone ? <Pressable onPress={() => Linking.openURL('tel:' + cur.customer.phone)} hitSlop={8}><Ionicons name="call" size={22} color={ok} /></Pressable> : null}
                    </View>
                    <Text style={{ color: muted, marginTop: 2 }}>{rs(cur.total)} · {cur.cash ? tr('Cash, not paid yet') : tr('Paid online')}</Text>
                    <ScrollView style={{ maxHeight: 130, marginTop: 8 }} nestedScrollEnabled>
                        {cur.items.map((it, i) => <Text key={i} style={{ color: text, paddingVertical: 2 }}>{it.quantity}× {it.name}</Text>)}
                    </ScrollView>
                    {cur.note ? <Text style={{ color: text, fontWeight: '800', marginTop: 6 }}>“{cur.note}”</Text> : null}
                    <Text style={{ color: muted, marginTop: 8, fontSize: 13 }}>
                        {cur.kind === 'collected' ? (cur.cash ? tr('He says he collected it. It is a cash order: did he pay?') : tr('He says he collected it.'))
                            : cur.kind === 'cancel' ? tr('He asks you to cancel it. It is already being made. If you say yes he is not charged.')
                                : (cur.cash ? tr('Choose how much of the bill you drop. He still pays the rest.') : tr('Choose how much you give back.'))}
                    </Text>

                    {cur.kind === 'not_wanted' ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                            {OPTS.map(([v, label]) => {
                                const sel = pct === v;
                                return (
                                    <Pressable key={v} onPress={() => setPct(v)} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: sel ? primary : border, backgroundColor: sel ? primary : 'transparent' }}>
                                        <Text style={{ color: sel ? onPrimary : text, fontWeight: '900' }}>{tr(label)}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    ) : null}
                    {cur.kind === 'not_wanted' && pct !== null ? (
                        <Text style={{ color: text, fontWeight: '900', marginBottom: 4 }}>
                            {cur.cash ? (owedIf(pct) > 0 ? tr('He will have to pay {n}', { n: rs(owedIf(pct)) }) : tr('He pays nothing')) : (pct > 0 ? tr('Refund {n}', { n: rs((cur.total * pct) / 100) }) : tr('No refund'))}
                        </Text>
                    ) : null}

                    <TextInput
                        value={msg} onChangeText={setMsg} placeholder={tr('Message to the customer (optional)')} placeholderTextColor={muted} maxLength={200} multiline
                        style={{ marginTop: 8, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, color: text, minHeight: 48, maxHeight: 90 }}
                    />

                    {cur.kind === 'collected' ? (
                        <View style={{ marginTop: 12 }}>
                            {cur.cash ? (
                                <View style={{ flexDirection: 'row' }}>
                                    <Button label={tr('Collected, paid')} icon="checkmark-circle" busy={busy === 'paid'} disabled={!!busy} onPress={() => send('paid', { result: 'paid' })} style={{ flex: 1, marginRight: 8 }} />
                                    <Button label={tr('Collected, NOT paid')} icon="alert-circle" kind="danger" busy={busy === 'unpaid'} disabled={!!busy} onPress={() => send('unpaid', { result: 'unpaid' })} style={{ flex: 1 }} />
                                </View>
                            ) : <Button label={tr('Yes, collected')} icon="checkmark-circle" busy={busy === 'paid'} disabled={!!busy} onPress={() => send('paid', { result: 'paid' })} />}
                            <Button label={tr('No, he has not collected')} icon="close-circle" kind="ghost" busy={busy === 'no'} disabled={!!busy} onPress={() => send('no', { result: 'no' })} style={{ marginTop: 8 }} />
                            {cur.cash ? <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('If NOT paid, the amount is kept as a bill he owes. He is reminded and cannot order until he pays.')}</Text> : null}
                        </View>
                    ) : null}
                    {cur.kind === 'not_wanted' ? <Button label={tr('Send my answer')} icon="send" busy={busy === 'refund'} disabled={!!busy || pct === null} onPress={() => send('refund', { refundPct: pct })} style={{ marginTop: 12 }} /> : null}
                    {cur.kind === 'cancel' ? (
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <Button label={tr('No, keep it')} icon="close-circle" kind="ghost" busy={busy === 'no'} disabled={!!busy} onPress={() => send('no', { accept: false })} style={{ flex: 1, marginRight: 8 }} />
                            <Button label={tr('Yes, cancel')} icon="checkmark-circle" kind="danger" busy={busy === 'yes'} disabled={!!busy} onPress={() => send('yes', { accept: true })} style={{ flex: 1 }} />
                        </View>
                    ) : null}
                </View>
            ) : null}
        </Sheet>
    );
}
