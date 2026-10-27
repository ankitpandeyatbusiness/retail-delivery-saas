// The table bill: every round he ordered with what it cost, what is still to pay, and the two things to do: order more, or ask for the bill.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Button, Pill } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { useTableBill } from '../../store/customers/useTableBill';
import { useAuthStore } from '../../store/common/useAuthStore';
import WaitTimer, { ServedIn, useTick, clock as mmss } from '../../components/common/WaitTimer';
import { CallCard, TipCard, SplitCard } from '../../components/customers/TableExtras';
import { nudgeTable, cancelOrder, askCancelOrder, freeMyTable } from '../../api/customers/shopApi';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { whereOf } from '../../utils/common/where';
import QueueLine from '../../components/customers/QueueLine';
import { tr } from '../../i18n';

const STATE = { placed: 'Waiting for the shop', accepted: 'Accepted', preparing: 'Being prepared', ready: 'Coming to your table', delivered: 'Served' };
const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function TableBillScreen() {
    const nav = useNavigation();
    const { background, text, muted, ok, warn, border } = useBrand();
    const bill = useTableBill((s) => s.bill);
    const loading = useTableBill((s) => s.loading);
    const user = useAuthStore((s) => s.user);
    const me = String(user?.id || user?._id || '');
    const [busy, setBusy] = useState(false);
    const [barH, setBarH] = useState(0);   // the real height of the buttons at the bottom: the list stops just above them, with no empty gap
    // read again every 15 seconds while he looks at it, so a served round stops showing "taking too long" and its cancel link by itself
    useFocusEffect(useCallback(() => { useTableBill.getState().load(); const t = setInterval(() => useTableBill.getState().load(), 15000); return () => clearInterval(t); }, []));

    const tick = useTick(!!bill?.open);
    const hurry = async () => {
        try { await nudgeTable(); await useTableBill.getState().load(); showToast(tr('The kitchen has been reminded. Thank you for waiting!')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Please try again.')); }
    };
    const refresh = async () => { setBusy(true); await useTableBill.getState().load(); setBusy(false); };
    const askBill = async () => {
        const yes = await ask({ title: tr('Ask for the bill?'), message: tr('The shop will bring your bill or take your payment at the counter.'), confirmText: tr('Ask for the bill'), cancelText: tr('Not yet') });
        if (!yes) return;
        try { await useTableBill.getState().ask(); showToast(tr('The shop has been told')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not ask for the bill. Please try again.')); }
    };

    // pay what is unpaid so far, online: the same payment-method screen as the cart; the paid rounds then fade, and what he orders next shows below as new
    const freeIt = async () => {
        const yes = await ask({ title: tr('Free the table?'), message: tr('Everyone on this bill is done and the table is given to other guests. To order again, scan the QR code on the table and order as before.'), confirmText: tr('Yes, free the table'), cancelText: tr('Not yet') });
        if (!yes) return;
        try { await freeMyTable(); await useTableBill.getState().load(); showToast(tr('The table is free. Thank you!')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not do that. Please try again.')); }
    };
    const payNow = () => nav.navigate('PaymentMethods', { payBill: true, current: 'upi' });

    // ordered by mistake: cancel the round himself in the first minutes; later the shop decides
    const roundCancel = async (r) => {
        const self = !!r.canCancel;
        const yes = await ask({
            title: self ? tr('Cancel this round?') : tr('Ask the shop to cancel?'),
            message: self ? tr('You will not be charged for it.') : tr('It is already being made, so the shop decides. They will reply soon.'),
            confirmText: self ? tr('Cancel the round') : tr('Ask the shop'), cancelText: tr('No'),
        });
        if (!yes) return;
        try {
            if (self) await cancelOrder(r.id); else await askCancelOrder(r.id);
            showToast(self ? tr('Round cancelled') : tr('Asked. The shop will reply soon.'));
            await useTableBill.getState().load();
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not do that. Please try again.')); }
    };

    if (!bill) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Table bill')} /><ListShimmer count={3} /></View>;
    if (!bill.open) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={bill.label ? tr('Table {n} · Bill {l}', { n: bill.table, l: bill.label }) : tr('Table bill')} />
                <View style={{ alignItems: 'center', padding: 40 }}>
                    <Ionicons name="checkmark-circle" size={64} color={ok} />
                    <Text style={{ color: text, fontWeight: '900', fontSize: 20, marginTop: 12 }}>{tr('Nothing to pay')}</Text>
                    <Text style={{ color: muted, textAlign: 'center', marginTop: 6 }}>{tr('You have no open table bill. Thank you for dining with us!')}</Text>
                    <Text style={{ color: muted, textAlign: 'center', marginTop: 10, fontSize: 12.5 }}>{tr('A paid table is freed after 15 minutes, or when you tap "I am done". To order more, scan the QR code on the table, pick your table and order as before.')}</Text>
                    {bill.owed ? <Text style={{ color: warn, fontWeight: '900', textAlign: 'center', marginTop: 16 }}>{tr('You still owe {n} from {where}. Please pay it at the counter on your next visit.', { n: rs(bill.owed.amount), where: whereOf(bill.owed.table) })}</Text> : null}
                </View>
            </View>
        );
    }
    const asked = bill.status === 'bill_asked';
    const shared = (bill.shares || []).length > 1;   // more than one guest on this bill: the rounds say whose they are
    // he may remind the kitchen 3 minutes after ordering, then once every 10 minutes (the server enforces the same)
    const live = bill.rounds.filter((r) => ['placed', 'accepted', 'preparing', 'ready'].includes(r.status));
    const oldest = live.length ? Math.min(...live.map((r) => new Date(r.times?.placed || r.at).getTime())) : 0;
    const cool = Math.max(oldest ? oldest + 3 * 60000 - tick : 0, bill.nudgeAt ? new Date(bill.nudgeAt).getTime() + 10 * 60000 - tick : 0);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Table {t} bill', { t: bill.table })} />
            <ScrollView contentContainerStyle={{ paddingBottom: (barH || 200) + 8 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} />}>
                {asked ? (
                    <Card tone={warn}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="receipt" size={22} color={warn} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: text, fontWeight: '900' }}>{tr('You asked for the bill')}</Text>
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('The shop is on its way. You can pay in cash or UPI at the counter.')}</Text>
                            </View>
                        </View>
                    </Card>
                ) : null}

                {live.length > 0 && !asked ? (
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="hourglass" size={22} color={warn} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: text, fontWeight: '900' }}>{tr('Taking too long?')}</Text>
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Send the kitchen a gentle reminder.')}</Text>
                            </View>
                        </View>
                        {cool > 0 ? (
                            <View style={{ marginTop: 10, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: alpha(muted, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: text, fontWeight: '800', textAlign: 'center', lineHeight: 20 }}>{tr('The kitchen knows. You can remind again in {t}', { t: mmss(cool) })}</Text>
                            </View>
                        ) : <Button label={tr('Please bring it fast 🙏')} icon="notifications" kind="ghost" onPress={hurry} style={{ marginTop: 10 }} />}
                    </Card>
                ) : null}

                <CallCard />

                {bill.rounds.map((r, i) => (
                    <View key={r.id} style={[{ marginBottom: 14 }, r.paid ? { opacity: 0.5 } : null]}>
                        <SectionTitle title={tr('Round {n} · {time}', { n: i + 1, time: clock(r.at) }) + (shared && r.by?.name ? ` · ${r.by.id === me ? tr('You') : r.by.name}` : '')} />
                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                                <Pill label={tr(STATE[r.status] || r.status)} color={r.status === 'delivered' ? ok : warn} />
                                {r.paid ? <View style={{ marginLeft: 6 }}><Pill label={shared && r.paidBy?.name ? `${tr('Paid')} · ${r.paidBy.id === me ? tr('You') : r.paidBy.name}` : tr('Paid')} color={ok} /></View> : <View style={{ marginLeft: 6 }}><Pill label={tr('Not paid')} color={warn} /></View>}
                            </View>
                            {r.status === 'delivered' ? <ServedIn times={r.times} style={{ marginBottom: 6 }} /> : <><QueueLine q={r.queue} compact /><WaitTimer since={r.times?.placed || r.at} style={{ marginBottom: 6 }} /></>}
                            {r.items.map((it, k) => (
                                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                                    {it.image ? (
                                        <Image source={{ uri: it.image }} style={{ width: 52, height: 52, borderRadius: 12, marginRight: 12, backgroundColor: alpha(muted, 0.12) }} contentFit="cover" transition={150} />
                                    ) : (
                                        <View style={{ width: 52, height: 52, borderRadius: 12, marginRight: 12, backgroundColor: alpha(muted, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                                            <Ionicons name="restaurant-outline" size={22} color={muted} />
                                        </View>
                                    )}
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text style={{ color: text, fontWeight: '700' }} numberOfLines={2}>{it.name}</Text>
                                        <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5, marginTop: 1 }} numberOfLines={1}>{it.quantity}×{it.addons?.length ? `  ·  ${it.addons.join(', ')}` : ''}</Text>
                                    </View>
                                    <Text style={{ color: muted, fontWeight: '700', marginLeft: 8 }}>{rs(it.total)}</Text>
                                </View>
                            ))}
                            <View style={{ flexDirection: 'row', paddingTop: 8, marginTop: 6, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                                <Text style={{ flex: 1, color: muted, fontWeight: '700' }}>{tr('Round total')}</Text>
                                <Text style={{ color: text, fontWeight: '900' }}>{rs(r.total)}</Text>
                            </View>
                            {!r.paid && (r.canCancel || r.canAsk) ? (
                                <Pressable onPress={() => roundCancel(r)} hitSlop={8} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                                    <Text style={{ color: warn, fontWeight: '800' }}>{r.canCancel ? tr('Ordered by mistake? Cancel this round') : tr('Ask the shop to cancel this round')}</Text>
                                </Pressable>
                            ) : r.asked && !r.paid ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 10 }}>{tr('You asked the shop to cancel. Waiting for their reply.')}</Text> : null}
                        </Card>
                    </View>
                ))}

                <TipCard bill={bill} />

                <Card>
                    <View style={{ flexDirection: 'row' }}>
                        <Text style={{ flex: 1, color: muted, fontWeight: '700' }}>{tr('Total so far')}</Text>
                        <Text style={{ color: text, fontWeight: '900' }}>{rs(bill.total)}</Text>
                    </View>
                    {bill.total !== bill.due ? (
                        <View style={{ flexDirection: 'row', marginTop: 6 }}>
                            <Text style={{ flex: 1, color: muted, fontWeight: '700' }}>{tr('Already paid')}</Text>
                            <Text style={{ color: ok, fontWeight: '900' }}>- {rs(bill.total - bill.due)}</Text>
                        </View>
                    ) : null}
                    {bill.tip > 0 ? (
                        <View style={{ flexDirection: 'row', marginTop: 6 }}>
                            <Text style={{ flex: 1, color: muted, fontWeight: '700' }}>{tr('Tip for the waiter')}</Text>
                            <Text style={{ color: text, fontWeight: '900' }}>+ {rs(bill.tip)}</Text>
                        </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                        <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 17 }}>{tr('To pay')}</Text>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 20 }}>{rs(bill.payable ?? bill.due)}</Text>
                    </View>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>{bill.payOnline && bill.due > 0 ? tr('Pay online from here, or in cash or UPI at the counter.') : tr('You pay once, at the end. Cash or UPI at the counter.')}</Text>
                </Card>

                <SplitCard bill={bill} />
            </ScrollView>

            <View onLayout={(e) => setBarH(Math.round(e.nativeEvent.layout.height))} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, backgroundColor: background, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                {bill.payOnline && bill.due > 0 ? <Button label={tr('Pay {n} online', { n: rs(bill.due) })} icon="card" onPress={payNow} style={{ marginBottom: 8 }} /> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
                    <Button label={tr('Order more')} icon="add" kind="ghost" onPress={() => nav.navigate('MainTabs', { screen: 'Home' })} style={{ flexGrow: 1, flexBasis: 140, margin: 4 }} />
                    {!(bill.due > 0) && live.length === 0 && bill.rounds.length > 0 ? <Button label={tr('I am done · Free the table')} icon="exit-outline" onPress={freeIt} style={{ flexGrow: 1.3, flexBasis: 160, margin: 4 }} /> : null}
                    {asked || !(bill.due > 0) ? null : <Button label={tr('Ask for the bill')} icon="receipt" kind={bill.payOnline && bill.due > 0 ? 'ghost' : undefined} busy={loading} onPress={askBill} style={{ flexGrow: 1.3, flexBasis: 160, margin: 4 }} />}
                </View>
            </View>
        </View>
    );
}
