// A customer who left unpaid pressed "I already paid": this slides up at once with the whole bill, and the owner answers
// Yes (the debt is cleared and the customer is apologised to) or No (with a message to the customer, who is asked to pay again).
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet } from './ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onNotification } from '../../api/common/socket';
import { fetchOwedClaims, answerOwedClaim, blockCustomer, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { ask } from '../common/dialog';
import PersonAvatar from './PersonAvatar';
import { tr } from '../../i18n';

// the Unpaid bills list can ask for the popup again
export const useClaimPrompt = create((set) => ({ stamp: 0, reopen: () => set({ stamp: Date.now() }) }));
const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const rs = (n) => `₹${Math.round(n * 100) / 100}`;

export default function OwedClaimHost() {
    const { text, muted, border, ok, error } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const on = role === 'admin' && !customerView && access !== 'blocked';
    const stamp = useClaimPrompt((s) => s.stamp);
    const [items, setItems] = useState([]);
    const [hidden, setHidden] = useState([]);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState('');
    const load = useCallback(() => { fetchOwedClaims().then((r) => setItems(r.items || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (!on) { setItems([]); return undefined; }
        load();
        const a = onNotification((n) => { if (n?.type === 'table_paid_claim') { setHidden([]); load(); } });
        const b = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => { a(); b.remove(); };
    }, [on, load]);
    useEffect(() => { if (stamp) { setHidden([]); load(); } }, [stamp, load]);

    const cur = on ? items.find((x) => !hidden.includes(x.id)) : null;
    useEffect(() => { setMsg(''); }, [cur?.id]);
    const answer = async (yes) => {
        setBusy(yes ? 'yes' : 'no');
        try {
            await answerOwedClaim(cur.id, yes, msg.trim());
            showToast(yes ? tr('Marked as paid. The customer is told sorry for the reminder.') : tr('The customer is told it was not paid.'));
            setItems((l) => l.filter((x) => x.id !== cur.id));
        } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };

    // he keeps claiming or never pays: block him from the shop (his login stops working); the claim is answered "no"
    const block = async () => {
        const who = cur.customers.find((c) => c.id);
        if (!who) return;
        const yes = await ask({ title: tr('Block this customer?'), message: tr('He will not be able to use the app of your shop. You can unblock him later from the Customers screen.'), confirmText: tr('Block'), cancelText: tr('No') });
        if (!yes) return;
        setBusy('block');
        try {
            await blockCustomer(who.id, true, { reason: `Left table ${cur.table} without paying, then said he had paid`, sessionId: cur.id });
            await answerOwedClaim(cur.id, false, msg.trim());
            showToast(tr('Customer blocked'));
            setItems((l) => l.filter((x) => x.id !== cur.id));
        } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };

    return (
        <Sheet visible={!!cur} onClose={() => cur && setHidden((h) => [...h, cur.id])} title={tr('Did this customer pay?')}>
            {cur ? (
                <View>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 28 }}>{rs(cur.amount)}</Text>
                    <Text style={{ color: muted, marginTop: 2 }}>{tr('Table {t} · left at {time}', { t: cur.table, time: hm(cur.leftAt) })} · {tr('says paid at {time}', { time: hm(cur.claimedAt) })}</Text>
                    {cur.customers.map((c, i) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <PersonAvatar photo={c.photo} size={36} />
                            <Text style={{ color: text, fontWeight: '800', flex: 1, marginLeft: 10 }} numberOfLines={1}>{c.name || tr('Customer')}{c.phone ? `  ·  ${c.phone}` : ''}</Text>
                            {c.phone ? <Pressable onPress={() => Linking.openURL('tel:' + c.phone)} hitSlop={8}><Ionicons name="call" size={20} color={ok} /></Pressable> : null}
                        </View>
                    ))}
                    <ScrollView style={{ maxHeight: 200, marginTop: 10 }} nestedScrollEnabled>
                        {cur.rounds.map((r, i) => (
                            <View key={r.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: alpha(muted, 0.2) }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{tr('Round {n}', { n: i + 1 })} · {hm(r.at)} · {rs(r.total)}{r.paid ? ` · ${tr('Paid')}` : ''}</Text>
                                {r.items.map((it, k) => <Text key={k} style={{ color: muted, fontSize: 12.5 }}>{it.quantity}× {it.name}{it.addons?.length ? ` (+ ${it.addons.join(', ')})` : ''}</Text>)}
                            </View>
                        ))}
                    </ScrollView>
                    <TextInput
                        value={msg} onChangeText={setMsg} placeholder={tr('Message to the customer (optional)')} placeholderTextColor={muted} maxLength={200} multiline
                        style={{ marginTop: 12, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, color: text, minHeight: 48, maxHeight: 90 }}
                    />
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <Button label={tr('Not Paid')} icon="close-circle" kind="danger" busy={busy === 'no'} disabled={!!busy} onPress={() => answer(false)} style={{ flex: 1, marginRight: 8 }} />
                        <Button label={tr('Paid')} icon="checkmark-circle" busy={busy === 'yes'} disabled={!!busy} onPress={() => answer(true)} style={{ flex: 1 }} />
                    </View>
                    <Button label={tr('Block this customer')} icon="ban" kind="ghost" busy={busy === 'block'} disabled={!!busy} onPress={block} style={{ marginTop: 10 }} />
                </View>
            ) : null}
        </Sheet>
    );
}
