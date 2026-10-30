// "My ticket": the QR and the details of the next booked table, straight away, no receipt to download. It opens without a signal:
// the booking card and the ticket are kept on the phone (store/customers/useBookingCard.js, components/customers/BookingTicket.jsx).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Button, Empty } from '../../components/owners/ui';
import BookingTicket from '../../components/customers/BookingTicket';
import { useBookingCard } from '../../store/customers/useBookingCard';
import { tr } from '../../i18n';

export default function MyTicketScreen() {
    const nav = useNavigation();
    const { background, muted } = useBrand();
    const card = useBookingCard((s) => s.card);
    const ready = useBookingCard((s) => s.ready);
    const [now, setNow] = useState(Date.now());
    useEffect(() => { useBookingCard.getState().load(); const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
    const live = card && new Date(card.endsAt).getTime() > now;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('My ticket')} />
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
                {live ? (
                    <>
                        <BookingTicket id={card.id} />
                        <Text style={{ color: muted, fontSize: 12, textAlign: 'center', marginTop: 12 }}>{tr('This ticket works without internet. It stops working when your booking time is over.')}</Text>
                    </>
                ) : ready ? <Empty icon="qr-code-outline" title={tr('No ticket yet')} hint={tr('Your ticket shows here once the restaurant allows your booking.')} /> : null}
                <Button label={tr('All my bookings')} icon="calendar-number-outline" kind="ghost" onPress={() => nav.navigate('MyBookings')} style={{ marginTop: 16 }} />
            </ScrollView>
        </View>
    );
}
