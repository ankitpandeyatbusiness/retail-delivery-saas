// The guest's booked table: a card above the tabs from the moment the owner allowed the booking until its slot is over.
// "Your table · Today 8:00 PM", "4 guests · Code ABCDE". Tap it for My reservations (the ticket QR is there and works without internet). A small arrow hides it; a round chip brings it back. It steps aside while he is dining in (the table bill bar takes its place)
// and sits above the active order bar when both are on screen.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, AppState, Animated, Easing, Dimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { useDock, useCrowded } from '../../store/customers/useDock';
import { useBookingCard } from '../../store/customers/useBookingCard';
import { useCartStore } from '../../store/customers/shopStores';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';
import { useCustomerDesktop } from '../../utils/common/layout';
import { useDeskBottom, DeskSlotReport } from './DeskSlot';
import { dayMonthShort } from '../../utils/common/dayNames';

const TAB_H = 62;
const ORDER_BAR_H = 76;
const CART_BAR_H = 66;   // the cart bar (or its round chip) sits at the bottom of these screens: the table card goes above it
const CART_SCREENS = ['Home', 'Search', 'Offers'];
const HIDE_ON = ['Login', 'Cart', 'Item', 'OrderPlaced', 'TableBill', 'BookTable', 'MyBookings'];

const todayIst = (now) => new Date(now + 330 * 60000).toISOString().slice(0, 10);
const dayWord = (date, now) => {
    const t = todayIst(now);
    if (date === t) return tr('Today');
    if (date === new Date(new Date(`${t}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) return tr('Tomorrow');
    return dayMonthShort(date);
};

export default function BookingStrip({ routeName, onOpen }) {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && ['rider', 'admin', 'kitchen', 'waiter'].indexOf(user.role) < 0;
    const card = useBookingCard((s) => s.card);
    const orderBar = useBookingCard((s) => s.orderBar);
    const dining = useTableBill((s) => !!s.bill?.open);
    const hidden = useBookingCard((s) => s.hidden);
    const away = useRef(new Animated.Value(hidden ? 1 : 0)).current;   // 0 = card shown, 1 = hidden: the card slides off to the right and the round chip slides in, like the other cards
    useEffect(() => { Animated.timing(away, { toValue: hidden ? 1 : 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [hidden, away]);
    const cartItems = useCartStore((s) => s.lines.length);
    const insets = useSafeAreaInsets();
    const desk = useCustomerDesktop();   // the desktop website: a card in the bottom-left stack, above the other cards (false in the phone app)
    const [cardH, setCardH] = useState(0);
    const stackBottom = useDeskBottom('booking');
    const { primary, primaryDark, onPrimary } = useBrand();
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

    const presentBooking = enabled && !!card && !dining && !HIDE_ON.includes(routeName) && new Date(card.endsAt).getTime() > now;
    useEffect(() => { useDock.getState().put('booking', presentBooking ? { icon: 'calendar', label: tr('Reservation'), sub: `${dayWord(card.date, now)} ${card.time}`, route: 'MyBookings' } : null); }, [presentBooking, card?.id, card?.time]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => useDock.getState().put('booking', null), []);
    const crowded = useCrowded('booking');
    if (!enabled || !card || dining || HIDE_ON.includes(routeName) || new Date(card.endsAt).getTime() <= now || crowded) return null;
    const left = Math.round((new Date(card.startsAt).getTime() - now) / 60000);
    const soon = left <= 30 && left > 0;
    const on = left <= 0;
    const bottom = desk ? stackBottom : insets.bottom + TAB_H + 18 + (orderBar ? ORDER_BAR_H : 0) + (cartItems > 0 && !dining && CART_SCREENS.includes(routeName) ? CART_BAR_H : 0);
    return (
        <>
        {desk ? <DeskSlotReport k="booking" h={hidden ? 56 : cardH} /> : null}
        <Animated.View onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h && h !== cardH) setCardH(h); }} pointerEvents={hidden ? 'none' : 'box-none'} style={{ position: 'absolute', ...(desk ? { left: 24, width: 400 } : { left: 12, right: 12 }), bottom, opacity: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: desk ? [{ scale: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }) }] : [{ translateX: away.interpolate({ inputRange: [0, 1], outputRange: [0, Dimensions.get('window').width] }) }], ...(desk ? { transformOrigin: 'left bottom' } : null) }}>
            <Pressable onPress={onOpen} accessibilityRole={Platform.OS === 'web' ? undefined : 'button'} style={({ hovered }) => [{ borderRadius: 18, backgroundColor: primary, elevation: 8, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }, desk && { borderRadius: 22, paddingVertical: 16, paddingHorizontal: 18, backgroundImage: `linear-gradient(120deg, ${primaryDark || primary}, ${primary})`, boxShadow: hovered ? `0 18px 44px ${primary}77` : `0 14px 36px ${primary}55`, transform: [{ translateY: hovered ? -3 : 0 }], cursor: 'pointer', transitionProperty: 'box-shadow, transform', transitionDuration: '200ms' }]}>
                <Ionicons name="calendar" size={20} color={onPrimary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: onPrimary, fontWeight: '900' }} numberOfLines={1}>{card.table ? tr('Table {n} · {d} {t}', { n: card.table, d: dayWord(card.date, now), t: card.time }) : tr('Your table · {d} {t}', { d: dayWord(card.date, now), t: card.time })}</Text>
                    <Text style={{ color: onPrimary, opacity: 0.85, fontSize: 12 }} numberOfLines={1}>
                        {on ? tr('Your slot has started · Code {c}', { c: card.code }) : soon ? tr('In {n} min · {g} guests · Code {c}', { n: left, g: card.party, c: card.code }) : tr('{g} guests · Code {c}', { g: card.party, c: card.code })}
                    </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={onPrimary} />
                <Pressable onPress={() => useBookingCard.getState().setHidden(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Hide')}
                    style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 8, backgroundColor: 'rgba(255,255,255,0.22)' }}>
                    <Ionicons name="chevron-down" size={18} color={onPrimary} />
                </Pressable>
            </Pressable>
        </Animated.View>
        <Animated.View pointerEvents={hidden ? 'box-none' : 'none'} style={{ position: 'absolute', ...(desk ? { left: 24 } : { right: 12 }), bottom, opacity: away, transform: desk ? [{ scale: away.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] : [{ translateX: away.interpolate({ inputRange: [0, 1], outputRange: [70, 0] }) }, { rotate: away.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] }) }], ...(desk ? { transformOrigin: 'left bottom' } : null) }}>
            <Pressable onPress={() => useBookingCard.getState().setHidden(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Show table card')}
                style={({ hovered }) => [{ width: 48, height: 48, borderRadius: 24, backgroundColor: primary, elevation: 8, alignItems: 'center', justifyContent: 'center' }, desk && { width: 56, height: 56, minWidth: 56, borderRadius: 28, paddingHorizontal: 0, boxShadow: hovered ? '0 12px 30px rgba(0,0,0,0.5)' : '0 10px 28px rgba(0,0,0,0.4)', transform: [{ scale: hovered ? 1.08 : 1 }], cursor: 'pointer', transitionProperty: 'transform, box-shadow', transitionDuration: '170ms' }]}>
                <Ionicons name="calendar" size={desk ? 24 : 22} color={onPrimary} />
            </Pressable>
        </Animated.View>
        </>
    );
}
