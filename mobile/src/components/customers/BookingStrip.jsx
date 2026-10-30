// The guest's booked table: a card above the tabs from the moment the owner allowed the booking until its slot is over.
// "Your table · Today 8:00 PM", "4 guests · Code ABCDE". Tap it for My bookings. It steps aside while he is dining in (the table bill bar takes its place)
// and sits above the active order bar when both are on screen.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { useBookingCard } from '../../store/customers/useBookingCard';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';

const TAB_H = 62;
const ORDER_BAR_H = 76;
const HIDE_ON = ['Login', 'Cart', 'Item', 'OrderPlaced', 'TableBill', 'BookTable', 'MyBookings'];

const todayIst = (now) => new Date(now + 330 * 60000).toISOString().slice(0, 10);
const dayWord = (date, now) => {
    const t = todayIst(now);
    if (date === t) return tr('Today');
    if (date === new Date(new Date(`${t}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) return tr('Tomorrow');
    return new Date(`${date}T12:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

export default function BookingStrip({ routeName, onOpen }) {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && ['rider', 'admin', 'kitchen', 'waiter'].indexOf(user.role) < 0;
    const card = useBookingCard((s) => s.card);
    const orderBar = useBookingCard((s) => s.orderBar);
    const dining = useTableBill((s) => !!s.bill?.open);
    const insets = useSafeAreaInsets();
    const { primary, onPrimary } = useBrand();
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        if (!enabled) { useBookingCard.getState().reset(); return undefined; }
        const load = () => useBookingCard.getState().load();
        load();
        const t = setInterval(() => { setNow(Date.now()); load(); }, 60000);
        const a = onNotification((n) => { if (String(n?.type || '').startsWith('booking_')) load(); });   // allowed, cancelled, reminded
        const b = AppState.addEventListener('change', (st) => { if (st === 'active') { setNow(Date.now()); load(); } });
        return () => { clearInterval(t); a(); b.remove(); };
    }, [enabled]);

    if (!enabled || !card || dining || HIDE_ON.includes(routeName) || new Date(card.endsAt).getTime() <= now) return null;
    const left = Math.round((new Date(card.startsAt).getTime() - now) / 60000);
    const soon = left <= 30 && left > 0;
    const on = left <= 0;
    const bottom = insets.bottom + TAB_H + 18 + (orderBar ? ORDER_BAR_H : 0);
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom }}>
            <Pressable onPress={onOpen} accessibilityRole="button" style={{ borderRadius: 18, backgroundColor: primary, elevation: 8, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="calendar" size={20} color={onPrimary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: onPrimary, fontWeight: '900' }} numberOfLines={1}>{tr('Your table · {d} {t}', { d: dayWord(card.date, now), t: card.time })}</Text>
                    <Text style={{ color: onPrimary, opacity: 0.85, fontSize: 12 }} numberOfLines={1}>
                        {on ? tr('Your slot has started · Code {c}', { c: card.code }) : soon ? tr('In {n} min · {g} guests · Code {c}', { n: left, g: card.party, c: card.code }) : tr('{g} guests · Code {c}', { g: card.party, c: card.code })}
                    </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={onPrimary} />
            </Pressable>
        </View>
    );
}
