// Unpaid bills: customers who left a table without paying. A list (Orders -> Unpaid bills), the popup with the whole bill and
// its buttons (Cash Paid, Online Paid, Remind, Call, Block), a one-tap "remind everyone", and the card on the owner's Home.
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button, Card, Pill, Sheet } from './ui';
import { ListShimmer } from './shimmer';
import BillDetails, { hm, rs } from './BillDetails';
import PersonAvatar from './PersonAvatar';
import { useClaimPrompt } from './OwedClaimHost';
import { fetchDineDebts, fetchDineBill, payDineDebt, forgiveDebt, remindDebt, remindAllDebts, blockCustomer, saveSettings, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { showToast } from '../customers/shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

const ago = (d) => { const m = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

// the list of unpaid bills, kept fresh
export function useDebts(on = true) {
    const [items, setItems] = useState(null);
    const load = useCallback(() => { fetchDineDebts().then((r) => setItems(r.items || [])).catch(() => setItems((x) => x || [])); }, []);
    useFocusEffect(useCallback(() => {
        if (!on) return undefined;
        load();
        const t = setInterval(load, 60000);
        const a = onNotification((n) => { if (n?.type === 'table_paid_claim') load(); });
        return () => { clearInterval(t); a(); };
    }, [on, load]));
    return [items, load];
}

export function DebtCard({ d, onOpen }) {
    const { text, muted, error, warn } = useBrand();
    const who = d.customers[0] || {};
    return (
        <Card onPress={onOpen}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <PersonAvatar photo={who.photo} size={44} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: text, fontWeight: '900' }} numberOfLines={1}>{d.customers.map((c) => c.name || c.phone || tr('Customer')).join(', ')}</Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Table {t}', { t: d.table })} · {tr('left {a} ago', { a: ago(d.at) })}</Text>
                </View>
                <Text style={{ color: error, fontWeight: '900', fontSize: 18 }}>{rs(d.amount)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                {d.claim ? <View style={{ marginRight: 6 }}><Pill label={tr('Says he paid')} color={warn} /></View> : null}
                {d.remindedAt ? <Text style={{ color: muted, fontSize: 12 }}>{tr('Reminded {a} ago', { a: ago(d.remindedAt) })}</Text> : <Text style={{ color: muted, fontSize: 12 }}>{tr('Not reminded yet')}</Text>}
            </View>
        </Card>
    );
}

// the whole bill, and what the owner can do about it
export function DebtSheet({ debt, onClose, onChanged }) {
    const { text, muted, error, warn } = useBrand();
    const [bill, setBill] = useState(null);
    const [busy, setBusy] = useState('');
    React.useEffect(() => { setBill(null); if (debt?.id) fetchDineBill(debt.id).then(setBill).catch((e) => showToast(apiError(e))); }, [debt?.id]);
    const who = (debt?.customers || []).find((c) => c.phone);
    const pay = async (method) => {
        setBusy(method);
        try { await payDineDebt(debt.id, method); showToast(tr('Marked as paid')); onChanged(); onClose(); } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const remind = async () => {
        setBusy('remind');
        try { await remindDebt(debt.id); showToast(tr('Reminder sent')); onChanged(); } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const forgive = async () => {
        const yes = await ask({ title: tr('Forgive this bill?'), message: tr('The {a} is written off. He can order again, and he is told the bill is cleared. This cannot be undone.', { a: rs(debt.amount) }), confirmText: tr('Forgive'), cancelText: tr('No') });
        if (!yes) return;
        setBusy('forgive');
        try { await forgiveDebt(debt.id); showToast(tr('Bill forgiven')); onChanged(); onClose(); } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const block = async () => {
        const c = (debt.customers || []).find((x) => x.id);
        if (!c) return;
        const yes = await ask({ title: tr('Block this customer?'), message: tr('He will not be able to use the app of your shop. You can unblock him later from the Customers screen.'), confirmText: tr('Block'), cancelText: tr('No') });
        if (!yes) return;
        try { await blockCustomer(c.id, true); showToast(tr('Customer blocked')); } catch (e) { showToast(apiError(e)); }
    };
    return (
        <Sheet visible={!!debt} onClose={onClose} title={debt ? tr('Unpaid bill · Table {t}', { t: debt.table }) : ''}>
            {debt ? (
                <View>
                    <Text style={{ color: error, fontWeight: '900', fontSize: 26 }}>{rs(debt.amount)}</Text>
                    <Text style={{ color: muted, marginBottom: 8 }}>{tr('He left at {time}', { time: hm(debt.at) })}{debt.remindedAt ? ` · ${tr('Reminded {a} ago', { a: ago(debt.remindedAt) })}` : ''}</Text>
                    {debt.claim ? (
                        <Pressable onPress={() => { onClose(); useClaimPrompt.getState().reopen(); }} style={{ padding: 12, borderRadius: 12, backgroundColor: alpha(warn, 0.14), marginBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="help-circle" size={20} color={warn} />
                            <Text style={{ color: text, fontWeight: '800', marginLeft: 8, flex: 1 }}>{tr('He says he paid. Tap to answer')}</Text>
                        </Pressable>
                    ) : null}
                    {!bill ? <ListShimmer count={1} rows /> : <BillDetails bill={bill} />}
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <Button label={tr('Cash Paid')} icon="cash" busy={busy === 'cash'} disabled={!!busy} onPress={() => pay('cash')} style={{ flex: 1, marginRight: 8 }} />
                        <Button label={tr('Online Paid')} icon="card" busy={busy === 'upi'} disabled={!!busy} onPress={() => pay('upi')} style={{ flex: 1 }} />
                    </View>
                    <View style={{ flexDirection: 'row', marginTop: 10 }}>
                        <Button label={tr('Remind')} icon="notifications" kind="ghost" busy={busy === 'remind'} disabled={!!busy} onPress={remind} style={{ flex: 1, marginRight: who ? 8 : 0 }} />
                        {who ? <Button label={tr('Call')} icon="call" kind="ghost" onPress={() => Linking.openURL('tel:' + who.phone)} style={{ flex: 1 }} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', paddingTop: 14 }}>
                        <Pressable onPress={forgive} hitSlop={8} style={{ marginRight: 28 }}><Text style={{ color: muted, fontWeight: '800' }}>{tr('Forgive this bill')}</Text></Pressable>
                        <Pressable onPress={block} hitSlop={8}><Text style={{ color: muted, fontWeight: '800' }}>{tr('Block this customer')}</Text></Pressable>
                    </View>
                </View>
            ) : null}
        </Sheet>
    );
}

// one tap: remind everybody who owes
export function RemindAll({ count, onDone }) {
    const [busy, setBusy] = useState(false);
    const go = async () => {
        const yes = await ask({ title: tr('Remind everyone?'), message: tr('{n} customers with an unpaid bill get a reminder now. Anyone reminded in the last 30 minutes is skipped.', { n: count }), confirmText: tr('Remind all'), cancelText: tr('No') });
        if (!yes) return;
        setBusy(true);
        try { const r = await remindAllDebts(); showToast(r.skipped ? tr('{a} reminded, {b} skipped (reminded a short while ago)', { a: r.sent, b: r.skipped }) : tr('{a} reminded', { a: r.sent })); onDone(); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    return <Button label={tr('Remind everyone')} icon="notifications" busy={busy} onPress={go} />;
}

// the card on the owner's Home: stays until every bill is paid, unless the owner hides it
export function UnpaidHomeCard() {
    const nav = useNavigation();
    const { text, muted, error } = useBrand();
    const dine = useHomeStore((st) => st.full.orders.dineIn);
    const on = !!dine?.enabled && dine?.owedOnHome !== false;
    const [items] = useDebts(on);
    if (!on || !items?.length) return null;
    const total = items.reduce((n, x) => n + x.amount, 0);
    const hide = async () => {
        const yes = await ask({ title: tr('Hide this card?'), message: tr('You can show it again in Dine in settings. The bills stay in Orders, Unpaid bills.'), confirmText: tr('Hide'), cancelText: tr('No') });
        if (!yes) return;
        try { await saveSettings({ orders: { dineIn: { owedOnHome: false } } }); await useHomeStore.getState().load(); } catch (e) { showToast(apiError(e)); }
    };
    return (
        <Card tone={error} onPress={() => nav.navigate('OrdersTab', { filter: 'unpaid', stamp: Date.now() })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="cash" size={24} color={error} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: text, fontWeight: '900' }}>{items.length === 1 ? tr('1 unpaid bill') : tr('{n} unpaid bills', { n: items.length })} · {rs(total)}</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Tap to see them and remind the customers')}</Text>
                </View>
                <Pressable onPress={hide} hitSlop={10}><Text style={{ color: muted, fontWeight: '800', fontSize: 12 }}>{tr('Hide')}</Text></Pressable>
            </View>
        </Card>
    );
}
