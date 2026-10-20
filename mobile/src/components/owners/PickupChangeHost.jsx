// A customer asks to move his pickup to a later time: this slides up at once with who he is, what he ordered, the time he has now and the
// time he asks for. The owner says yes (the time is changed) or no (it stays); the customer gets a polite message either way.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet } from './ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onNotification } from '../../api/common/socket';
import { fetchPickupRequests, answerPickupRequest, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const span = (w) => (w?.from ? `${new Date(w.from).getDate()} ${MON[new Date(w.from).getMonth()]}, ${hm(w.from)} – ${hm(w.to)}` : '');
const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const PAY = { cod: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet' };

export default function PickupChangeHost() {
    const { text, muted, border, ok, primary, error } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const on = role === 'admin' && !customerView && access !== 'blocked';
    const [items, setItems] = useState([]);
    const [hidden, setHidden] = useState([]);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState('');
    const load = useCallback(() => { fetchPickupRequests().then((r) => setItems(r.items || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (!on) { setItems([]); return undefined; }
        load();
        const a = onNotification((n) => { if (n?.type === 'pickup_time_request') { setHidden([]); load(); } });
        const b = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => { a(); b.remove(); };
    }, [on, load]);

    const cur = on ? items.find((x) => !hidden.includes(x.id)) : null;
    useEffect(() => { setMsg(''); }, [cur?.id]);
    const answer = async (accept) => {
        setBusy(accept ? 'yes' : 'no');
        try {
            await answerPickupRequest(cur.id, accept, msg.trim());
            showToast(accept ? tr('Pickup time changed. The customer is told.') : tr('The time stays. The customer is told politely.'));
            setItems((l) => l.filter((x) => x.id !== cur.id));
        } catch (e) { showToast(apiError(e)); if (e?.response?.status === 404 || e?.response?.status === 409) load(); } finally { setBusy(''); }
    };

    return (
        <Sheet visible={!!cur} onClose={() => cur && setHidden((h) => [...h, cur.id])} title={tr('Change the pickup time?')}>
            {cur ? (
                <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 17, flex: 1 }} numberOfLines={1}>{cur.customer.name || tr('Customer')} · #{cur.orderNo}</Text>
                        {cur.customer.phone ? <Pressable onPress={() => Linking.openURL('tel:' + cur.customer.phone)} hitSlop={8}><Ionicons name="call" size={22} color={ok} /></Pressable> : null}
                    </View>
                    {cur.customer.phone ? <Text style={{ color: muted, marginTop: 2 }}>{cur.customer.phone}</Text> : null}
                    <View style={{ marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: alpha(primary, 0.08) }}>
                        <Text style={{ color: muted, fontWeight: '800', fontSize: 12 }}>{tr('PICKUP TIME NOW')}</Text>
                        <Text style={{ color: text, fontWeight: '800', marginBottom: 8 }}>{span(cur.was)}</Text>
                        <Text style={{ color: muted, fontWeight: '800', fontSize: 12 }}>{tr('ASKS FOR')}</Text>
                        <Text style={{ color: primary, fontWeight: '900', fontSize: 16 }}>{span(cur.asked)}</Text>
                    </View>
                    {cur.overdue ? <Text style={{ color: error, fontWeight: '900', marginTop: 8 }}>{tr('His pickup time is already over.')}</Text> : null}
                    <ScrollView style={{ maxHeight: 150, marginTop: 10 }} nestedScrollEnabled>
                        {cur.items.map((it, i) => <Text key={i} style={{ color: text, paddingVertical: 2 }}>{it.quantity}× {it.name}</Text>)}
                    </ScrollView>
                    <Text style={{ color: muted, marginTop: 6, fontSize: 12.5 }}>{rs(cur.total)} · {PAY[cur.pay.method] || ''}{cur.pay.status === 'paid' ? ` · ${tr('Paid')}` : ''} · {cur.status === 'ready' ? tr('Already ready') : tr('Not ready yet')}</Text>
                    <TextInput
                        value={msg} onChangeText={setMsg} placeholder={tr('Message to the customer (optional)')} placeholderTextColor={muted} maxLength={200} multiline
                        style={{ marginTop: 12, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, color: text, minHeight: 48, maxHeight: 90 }}
                    />
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <Button label={tr('No, keep it')} icon="close-circle" kind="danger" busy={busy === 'no'} disabled={!!busy} onPress={() => answer(false)} style={{ flex: 1, marginRight: 8 }} />
                        <Button label={tr('Yes, change')} icon="checkmark-circle" busy={busy === 'yes'} disabled={!!busy} onPress={() => answer(true)} style={{ flex: 1 }} />
                    </View>
                </View>
            ) : null}
        </Sheet>
    );
}
