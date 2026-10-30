// Bookings: one day at a time. See who is coming, mark a guest seated or a no-show, or cancel a booking.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { booking as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { shareBookingReceipt, hasReceipt } from '../../utils/customers/shareBookingReceipt';
import { tr } from '../../i18n';

export const BOOKING_STATUS = { held: 'Waiting for payment', confirmed: 'Booked', seated: 'Seated', no_show: 'No-show', cancelled: 'Cancelled', expired: 'Expired' };
// what became of the deposit, in words (guest and owner screens)
export const DEPOSIT_STATUS = { unpaid: 'Deposit not paid', paid: 'Deposit paid', refunding: 'Refund on its way', refund_failed: 'Refund on its way', refunded: 'Deposit refunded', kept: 'Deposit kept by the restaurant', adjusted: 'Deposit taken off the bill' };
const shift = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const nice = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function OwnerBookingsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, ok, error } = useBrand();
    const [date, setDate] = useState(todayIst());
    const [data, setData] = useState(null);
    const [busyId, setBusyId] = useState('');
    const [receiptId, setReceiptId] = useState('');

    const load = useCallback(() => api.day(date).then((r) => setData(r)).catch((e) => { useOwnerStore.getState().noteError(e); showToast(apiError(e)); setData((x) => x || { items: [], seats: 0, upcoming: 0 }); }), [date]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => onNotification((n) => { if (['booking_new', 'booking_cancelled'].includes(String(n?.type))) load(); }), [load]);

    const allow = async (b) => {
        setBusyId(b._id);
        try { await api.allow(b._id); showToast(tr('The guest is told the table is confirmed')); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const freeIt = async (b) => {
        setBusyId(b._id);
        try { await api.free(b._id); showToast(tr('The table is free for other guests')); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const adjust = async (b) => {
        setBusyId(b._id);
        try { await api.adjusted(b._id); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const act = async (b, kind) => {
        if (kind === 'cancel') {
            const yes = await ask({ title: tr('Cancel this booking?'), message: tr('{n} will be told. The seats are free again.', { n: b.name }), confirmText: tr('Cancel booking'), destructive: true });
            if (!yes) return;
        }
        setBusyId(b._id);
        try { await (kind === 'seat' ? api.seat(b._id) : kind === 'noshow' ? api.noShow(b._id) : api.cancel(b._id)); await load(); }
        catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const tone = (s) => (s === 'seated' ? ok : s === 'confirmed' ? primary : s === 'no_show' ? error : muted);
    const arrow = (n, icon) => <Pressable onPress={() => { setData(null); setDate((d) => shift(d, n)); }} hitSlop={10} style={{ padding: 8 }}><Ionicons name={icon} size={22} color={text} /></Pressable>;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Bookings')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }}>
                {arrow(-1, 'chevron-back')}
                <Pressable onPress={() => { setData(null); setDate(todayIst()); }} style={{ alignItems: 'center' }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{date === todayIst() ? tr('Today') : nice(date)}</Text>
                    <Text style={{ color: muted, fontSize: 12 }}>{data ? tr('{n} guests booked', { n: data.seats }) + (data.waiting ? ` · ${tr('{n} waiting for a table', { n: data.waiting })}` : '') : ' '}</Text>
                </Pressable>
                {arrow(1, 'chevron-forward')}
            </View>
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {data === null ? <ListShimmer /> : null}
                {data && !data.items.length ? <Empty icon="calendar-outline" title={tr('No bookings this day')} hint={data.upcoming ? tr('{n} more are coming on other days.', { n: data.upcoming }) : tr('Bookings guests make will appear here.')} /> : null}
                {(data?.items || []).map((b) => (
                    <Card key={b._id} style={{ opacity: b.status === 'cancelled' ? 0.6 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 20, width: 70 }}>{b.time}</Text>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16 }}>{b.name} · {tr('{n} guests', { n: b.party })}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{b.table ? `${tr('Table {t}', { t: b.table })} · ` : ''}{b.phone} · {tr('Code')} {b.code}</Text>
                            </View>
                            <Pill label={tr(BOOKING_STATUS[b.status])} color={tone(b.status)} />
                        </View>
                        {b.note ? <Text style={{ color: text, marginTop: 8 }}>{b.note}</Text> : null}
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('₹{n}', { n: b.deposit?.amount || 0 })} · {tr(DEPOSIT_STATUS[b.deposit?.status] || 'Deposit paid')}</Text>
                        {hasReceipt(b) ? <Button label={tr('Receipt')} icon="document-text-outline" kind="ghost" busy={receiptId === b._id} onPress={() => shareBookingReceipt(`/shop/booking/${b._id}/receipt`, b.code, (on) => setReceiptId(on ? b._id : ''))} style={{ marginTop: 10 }} /> : null}
                        {b.status === 'seated' && !b.freedAt && new Date(b.endsAt) > new Date() ? <Button label={tr('Guest left: table is free now')} icon="log-out-outline" kind="ghost" busy={busyId === b._id} onPress={() => freeIt(b)} style={{ marginTop: 10 }} /> : null}
                        {b.status === 'seated' && b.deposit?.credit === 'pending' ? (
                            <View style={{ marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: primary }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{tr('Take ₹{n} off the table bill of this guest', { n: b.deposit.amount })}</Text>
                                <Button label={tr('Done, taken off the bill')} icon="checkmark" busy={busyId === b._id} onPress={() => adjust(b)} style={{ marginTop: 8 }} />
                            </View>
                        ) : null}
                        {b.status === 'confirmed' && !b.approvedAt ? <Button label={tr('Allow this booking')} icon="checkmark-done" kind="ghost" busy={busyId === b._id} onPress={() => allow(b)} style={{ marginTop: 10 }} /> : null}
                        {b.status === 'confirmed' && b.approvedAt ? <Text style={{ color: ok, fontWeight: '800', marginTop: 8 }}>{tr('You allowed this booking')}</Text> : null}
                        {b.status === 'cancelled' && b.cancelNote ? <Text style={{ color: muted, marginTop: 8 }}>{tr('Your message: {m}', { m: b.cancelNote })}</Text> : null}
                        {b.status === 'confirmed' ? (
                            <View style={{ flexDirection: 'row', marginTop: 10 }}>
                                <Button label={tr('Seated')} icon="checkmark" busy={busyId === b._id} onPress={() => act(b, 'seat')} style={{ flex: 1, marginRight: 8 }} />
                                <Button label={tr('No-show')} kind="ghost" busy={busyId === b._id} onPress={() => act(b, 'noshow')} style={{ flex: 1, marginRight: 8 }} />
                                <Button label="" icon="call" kind="ghost" iconOnly onPress={() => Linking.openURL(`tel:${String(b.phone).replace(/\D/g, '')}`)} style={{ marginRight: 8 }} />
                                <Button label={tr('Deny')} icon="close" kind="danger" busy={busyId === b._id} onPress={() => nav.navigate('OwnerBookingDeny', { id: String(b._id) })} />
                            </View>
                        ) : null}
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Booking settings')} icon="settings-outline" kind="ghost" onPress={() => nav.navigate('OwnerBookingSettings')} /></View>
            </ScrollView>
        </View>
    );
}
