// Account, My bookings: my tables, with the code to show at the door, and a way to cancel.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { BOOKING_STATUS } from '../owners/OwnerBookingsScreen';
import { fetchMyBookings, cancelBooking } from '../../api/customers/shopApi';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { tr } from '../../i18n';

export default function MyBookingsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, ok, error } = useBrand();
    const [items, setItems] = useState(null);
    const [busyId, setBusyId] = useState('');
    const load = useCallback(() => { fetchMyBookings().then((r) => setItems(r.items || [])).catch(() => setItems((x) => x || [])); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const cancel = async (b) => {
        const yes = await ask({ title: tr('Cancel this booking?'), message: tr('{d} at {t}, {n} guests.', { d: b.date, t: b.time, n: b.party }), confirmText: tr('Cancel booking'), destructive: true });
        if (!yes) return;
        setBusyId(b._id);
        try { await cancelBooking(b._id); await load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not cancel')); } finally { setBusyId(''); }
    };
    const tone = (s) => (s === 'seated' ? ok : s === 'confirmed' ? primary : s === 'no_show' || s === 'cancelled' ? error : muted);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My bookings')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {items && !items.length ? <Empty icon="calendar-outline" title={tr('No bookings yet')} hint={tr('Book a table from your account.')} /> : null}
                {(items || []).map((b) => (
                    <Card key={b._id} style={{ opacity: b.status === 'cancelled' ? 0.6 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{b.date} · {b.time}</Text>
                                <Text style={{ color: muted, marginTop: 2 }}>{tr('{n} guests', { n: b.party })} · {tr('Deposit ₹{n}', { n: b.deposit?.amount || 0 })}</Text>
                            </View>
                            <Pill label={tr(BOOKING_STATUS[b.status])} color={tone(b.status)} />
                        </View>
                        {b.status === 'confirmed' ? <Text style={{ color: text, marginTop: 8, fontWeight: '800' }}>{tr('Show this code: {c}', { c: b.code })}</Text> : null}
                        {b.status === 'confirmed' && new Date(b.startsAt) > new Date() ? <Button label={tr('Cancel booking')} kind="ghost" busy={busyId === b._id} onPress={() => cancel(b)} style={{ marginTop: 10 }} /> : null}
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Book a table')} icon="add" onPress={() => nav.navigate('BookTable')} /></View>
            </ScrollView>
        </View>
    );
}
