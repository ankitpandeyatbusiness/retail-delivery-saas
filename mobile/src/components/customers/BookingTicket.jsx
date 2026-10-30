// The guest's ticket, like a cinema one: a QR, the table, the day and the time. The shop scans it at the door.
// The QR is kept on the phone after it is loaded once, so it still opens without a signal.
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrand } from '../common/kit';
import QrCode from '../common/QrCode';
import { fetchBookingTicket } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

const KEY = (id) => `ticket:${id}`;
const nice = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const ended = (t) => Date.now() > new Date(t.endsAt || new Date(t.startsAt).getTime() + 3600000).getTime();

export default function BookingTicket({ id }) {
    const { text, muted, primary, ok, surface, border } = useBrand();
    const [t, setT] = useState(null);
    const [failed, setFailed] = useState(false);
    const [over, setOver] = useState(false);   // the slot is finished: no QR any more

    useEffect(() => {
        let live = true;
        const gone = () => { AsyncStorage.removeItem(KEY(id)).catch(() => { }); if (live) { setT(null); setOver(true); } };
        AsyncStorage.getItem(KEY(id)).then((x) => { if (!x) return; const c = JSON.parse(x); if (ended(c)) gone(); else if (live) setT((cur) => cur || c); }).catch(() => { });
        fetchBookingTicket(id)
            .then((r) => { if (ended(r)) return gone(); if (live) { setT(r); setFailed(false); } AsyncStorage.setItem(KEY(id), JSON.stringify(r)).catch(() => { }); })
            .catch((e) => { if (e?.response?.status === 410) gone(); else if (live) setFailed(true); });
        const timer = setInterval(() => setT((cur) => { if (cur && ended(cur)) { AsyncStorage.removeItem(KEY(id)).catch(() => { }); setOver(true); return null; } return cur; }), 30000);   // the slot ends while the screen is open
        return () => { live = false; clearInterval(timer); };
    }, [id]);

    if (over) return <Text style={{ color: muted, marginTop: 8 }}>{tr('This booking time is over. The ticket is no longer valid.')}</Text>;
    if (!t) return failed ? <Text style={{ color: muted, marginTop: 8 }}>{tr('The ticket could not be loaded. Check your internet.')}</Text> : <ActivityIndicator color={primary} style={{ marginTop: 12 }} />;
    const arrived = t.status === 'seated';
    return (
        <View style={{ marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 16, alignItems: 'center' }}>
            <Text style={{ color: muted, fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>{(t.shop || tr('Your table')).toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', marginTop: 10, marginBottom: 14 }}>
                <View style={{ alignItems: 'center', paddingHorizontal: 14 }}>
                    <Text style={{ color: muted, fontSize: 11 }}>{tr('TABLE')}</Text>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 28 }}>{t.table || '-'}</Text>
                </View>
                <View style={{ alignItems: 'center', paddingHorizontal: 14, borderLeftWidth: 1, borderLeftColor: border }}>
                    <Text style={{ color: muted, fontSize: 11 }}>{tr('DATE')}</Text>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 6 }}>{nice(t.date)}</Text>
                </View>
                <View style={{ alignItems: 'center', paddingHorizontal: 14, borderLeftWidth: 1, borderLeftColor: border }}>
                    <Text style={{ color: muted, fontSize: 11 }}>{tr('TIME')}</Text>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 6 }}>{t.time}</Text>
                </View>
            </View>
            <View style={{ opacity: arrived ? 0.25 : 1 }}><QrCode qr={t.qr} width={200} /></View>
            {arrived ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <Ionicons name="checkmark-circle" size={20} color={ok} />
                    <Text style={{ color: ok, fontWeight: '900', marginLeft: 6 }}>{tr('You have arrived. Enjoy your meal!')}</Text>
                </View>
            ) : (
                <>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, marginTop: 12, letterSpacing: 2 }}>{t.code}</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 4, textAlign: 'center' }}>{tr('{g} guests · Show this QR at the door', { g: t.party })}</Text>
                </>
            )}
        </View>
    );
}
