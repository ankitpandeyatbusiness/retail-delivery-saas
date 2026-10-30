// Account, My reservations: my tables, with the code to show at the door, the state of my deposit, and a way to cancel.
// A booking waiting for its deposit keeps the seats for a few minutes; "Pay deposit" finishes it.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onNotification } from '../../api/common/socket';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { BOOKING_STATUS, DEPOSIT_STATUS } from '../owners/OwnerBookingsScreen';
import { fetchMyBookings, cancelBooking, payBookingAgain, fetchMyWaitlist, leaveWaitlist } from '../../api/customers/shopApi';
import BookingTicket from '../../components/customers/BookingTicket';
import { shareBookingReceipt, hasReceipt } from '../../utils/customers/shareBookingReceipt';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { tr } from '../../i18n';

const clock = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function MyBookingsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, onPrimary, ok, error, border, surface } = useBrand();
    const [filter, setFilter] = useState('upcoming');   // upcoming | confirmed | cancelled | past
    const [items, setItems] = useState(null);
    const [waits, setWaits] = useState([]);
    const [busyId, setBusyId] = useState('');
    const [receiptId, setReceiptId] = useState('');
    const [shut, setShut] = useState({});   // tickets the guest closed by hand (the nearest booking's ticket opens by itself)
    const load = useCallback(() => {
        fetchMyBookings().then((r) => {
            setItems(r.items || []);
            // a booking that is not on any more must not keep its QR on the phone
            (r.items || []).filter((b) => ['cancelled', 'expired', 'no_show'].includes(b.status)).forEach((b) => AsyncStorage.removeItem(`ticket:${b._id}`).catch(() => { }));
        }).catch(() => setItems((x) => x || [])).finally(() => {});
        fetchMyWaitlist().then((r) => setWaits(r.items || [])).catch(() => { });
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    // the restaurant allowed, cancelled or took back something: the list (and the QR) change at once
    useEffect(() => onNotification((n) => { if (String(n?.type || '').startsWith('booking_')) load(); }), [load]);

    const waiting = (b) => b.status === 'held' && new Date(b.holdUntil) > new Date();
    const endOf = (b) => new Date(b.endsAt || new Date(b.startsAt).getTime() + 3600000).getTime();
    const gone = (b) => ['cancelled', 'expired'].includes(b.status);
    const past = (b) => !gone(b) && b.status !== 'held' && (endOf(b) <= Date.now() || b.status === 'no_show');
    const inFilter = (b) => (filter === 'cancelled' ? gone(b) : filter === 'past' ? past(b) : filter === 'confirmed' ? ['confirmed', 'seated'].includes(b.status) : !gone(b) && !past(b) && (b.status !== 'held' || waiting(b)));
    const shown = (items || []).filter((b) => (b.status !== 'held' || waiting(b) || gone(b)) && inFilter(b));

    const cancel = async (b) => {
        const refund = b.deposit?.status === 'paid'
            ? (new Date(b.startsAt).getTime() - Date.now() >= (b.rules?.refundHours ?? 0) * 3600000 ? tr('Your deposit goes back to you.') : tr('Too late for a refund: the restaurant keeps the deposit.'))
            : '';
        const yes = await ask({ title: tr('Cancel this booking?'), message: `${tr('{d} at {t}, {n} guests.', { d: b.date, t: b.time, n: b.party })} ${refund}`.trim(), confirmText: tr('Cancel booking'), destructive: true });
        if (!yes) return;
        setBusyId(b._id);
        try { await cancelBooking(b._id); await load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not cancel')); } finally { setBusyId(''); }
    };
    const payNow = async (b) => {
        setBusyId(b._id);
        try {
            const { booking, pay } = await payBookingAgain(b._id);
            nav.navigate('PaymentMethods', { deposit: { booking, pay }, current: 'upi' });
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not start the payment')); } finally { setBusyId(''); await load(); }
    };
    const hasTicket = (b) => ((b.status === 'confirmed' && !!b.approvedAt) || b.status === 'seated') && new Date(b.endsAt || new Date(b.startsAt).getTime() + 3600000) > new Date();
    const nearest = shown.filter((b) => b.status === 'confirmed' && b.approvedAt && new Date(b.endsAt || b.startsAt) > new Date()).sort((a, c) => new Date(a.startsAt) - new Date(c.startsAt))[0];
    const open = (b) => (shut[b._id] === undefined ? nearest?._id === b._id : !shut[b._id]);
    const tone = (s) => (s === 'seated' ? ok : s === 'confirmed' ? primary : s === 'no_show' || s === 'cancelled' ? error : muted);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My reservations')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 38, marginTop: 4, marginBottom: 6 }} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
                {[['upcoming', 'Upcoming'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled'], ['past', 'Past']].map(([k, l]) => (
                    <Pressable key={k} onPress={() => setFilter(k)} style={{ marginRight: 8, paddingHorizontal: 16, height: 38, justifyContent: 'center', borderRadius: 19, borderWidth: 1, borderColor: filter === k ? primary : border, backgroundColor: filter === k ? primary : surface }}>
                        <Text style={{ color: filter === k ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{tr(l)}</Text>
                    </Pressable>
                ))}
            </ScrollView>
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {items && !shown.length ? <Empty icon="calendar-outline" title={filter === 'upcoming' ? tr('No upcoming reservations') : tr('Nothing here')} hint={filter === 'upcoming' ? tr('Reserve a table from your account.') : tr('Pick another tab above.')} /> : null}
                {shown.map((b) => (
                    <Card key={b._id} style={{ opacity: b.status === 'cancelled' ? 0.6 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{b.date} · {b.time}{b.table ? ` · ${tr('Table {t}', { t: b.table })}` : ''}</Text>
                                <Text style={{ color: muted, marginTop: 2 }}>{tr('{n} guests', { n: b.party })} · {tr('₹{n}', { n: b.deposit?.amount || 0 })} {tr(DEPOSIT_STATUS[b.deposit?.status] || '')}</Text>
                            </View>
                            <Pill label={tr(BOOKING_STATUS[b.status])} color={tone(b.status)} />
                        </View>
                        {b.status === 'confirmed' && b.approvedAt ? <Text style={{ color: ok, fontWeight: '800', marginTop: 8 }}>{tr('The restaurant confirmed your table')}</Text> : null}
                        {b.status === 'cancelled' && b.cancelledBy === 'owner' ? <Text style={{ color: text, marginTop: 8 }}>{tr('The restaurant cancelled this booking.')}{b.deposit?.status === 'refunded' || b.deposit?.status === 'refunding' ? ' ' + tr('Your full deposit is being refunded.') : ''}{b.cancelNote ? ' ' + b.cancelNote : ''}</Text> : null}
                        {waiting(b) ? <Text style={{ color: text, marginTop: 8 }}>{tr('Pay the deposit before {t} or the table is let go.', { t: clock(b.holdUntil) })}</Text> : null}
                        {b.status === 'confirmed' && !b.approvedAt ? <Text style={{ color: text, marginTop: 8, fontWeight: '800' }}>{tr('Show this code: {c}', { c: b.code })}</Text> : null}
                        {hasTicket(b) ? <Button label={open(b) ? tr('Hide ticket') : tr('Show ticket')} icon={open(b) ? 'chevron-up' : 'qr-code-outline'} kind={open(b) ? 'ghost' : 'primary'} onPress={() => setShut((x) => ({ ...x, [b._id]: open(b) }))} style={{ marginTop: 10 }} /> : null}
                        {hasTicket(b) && open(b) ? <BookingTicket id={b._id} /> : null}
                        {hasReceipt(b) ? <Button label={tr('Download receipt')} icon="document-text-outline" kind="ghost" busy={receiptId === b._id} onPress={() => shareBookingReceipt(`/bookings/${b._id}/receipt`, b.code, (on) => setReceiptId(on ? b._id : ''))} style={{ marginTop: 10 }} /> : null}
                        {waiting(b) ? <Button label={tr('Pay ₹{n} deposit', { n: b.deposit?.amount || 0 })} icon="card" busy={busyId === b._id} onPress={() => payNow(b)} style={{ marginTop: 10 }} /> : null}
                        {(b.status === 'confirmed' || waiting(b)) && new Date(b.startsAt) > new Date() ? <Button label={tr('Cancel booking')} kind="ghost" busy={busyId === b._id} onPress={() => cancel(b)} style={{ marginTop: 10 }} /> : null}
                    </Card>
                ))}
                {filter === 'upcoming' ? waits.map((w) => (
                    <Card key={w._id}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Waiting for a table')}</Text>
                        <Text style={{ color: muted, marginTop: 2 }}>{w.date} · {w.time} · {tr('{n} guests', { n: w.party })}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('We will tell you if a table comes free.')}</Text>
                        <Button label={tr('Leave the waitlist')} kind="ghost" onPress={async () => { try { await leaveWaitlist(w._id); await load(); } catch (e) { showToast(tr('Could not leave the waitlist')); } }} style={{ marginTop: 10 }} />
                    </Card>
                )) : null}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Reserve a table')} icon="add" onPress={() => nav.navigate('BookTable')} /></View>
            </ScrollView>
        </View>
    );
}
