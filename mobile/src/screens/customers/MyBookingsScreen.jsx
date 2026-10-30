// Account, My bookings: my tables, with the code to show at the door, the state of my deposit, and a way to cancel.
// A booking waiting for its deposit keeps the seats for a few minutes; "Pay deposit" finishes it.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
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
    const { background, text, muted, primary, ok, error } = useBrand();
    const [items, setItems] = useState(null);
    const [waits, setWaits] = useState([]);
    const [busyId, setBusyId] = useState('');
    const [receiptId, setReceiptId] = useState('');
    const [shut, setShut] = useState({});   // tickets the guest closed by hand (the nearest booking's ticket opens by itself)
    const load = useCallback(() => {
        fetchMyBookings().then((r) => setItems(r.items || [])).catch(() => setItems((x) => x || [])).finally(() => {});
        fetchMyWaitlist().then((r) => setWaits(r.items || [])).catch(() => { });
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const waiting = (b) => b.status === 'held' && new Date(b.holdUntil) > new Date();
    const shown = (items || []).filter((b) => b.status !== 'held' || waiting(b));

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
            <PageHeader title={tr('My bookings')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {items && !shown.length ? <Empty icon="calendar-outline" title={tr('No bookings yet')} hint={tr('Book a table from your account.')} /> : null}
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
                {waits.map((w) => (
                    <Card key={w._id}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Waiting for a table')}</Text>
                        <Text style={{ color: muted, marginTop: 2 }}>{w.date} · {w.time} · {tr('{n} guests', { n: w.party })}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('We will tell you if a table comes free.')}</Text>
                        <Button label={tr('Leave the waitlist')} kind="ghost" onPress={async () => { try { await leaveWaitlist(w._id); await load(); } catch (e) { showToast(tr('Could not leave the waitlist')); } }} style={{ marginTop: 10 }} />
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Book a table')} icon="add" onPress={() => nav.navigate('BookTable')} /></View>
            </ScrollView>
        </View>
    );
}
