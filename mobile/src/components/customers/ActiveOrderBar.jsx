// A bar above the tabs, on every screen, while the customer has an order in progress: "Order #12 · Being prepared · View".
// Tap it to open the order (or the Orders tab when there are several). It sits out of the way when:
//   - the live delivery bar (LiveOrderHost: the rider is on the way, with the map) is already showing, or
//   - the customer is on a screen about an order / paying / logging in.
// Mounted once in the navigator, next to LiveOrderHost.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { tint } from './shop';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { useLiveTripStore } from '../../store/customers/useLiveTripStore';
import { fetchOrders } from '../../api/customers/shopApi';
import { onOrderUpdate, onNotification } from '../../api/common/socket';
import { isActive } from './orders';
import { tr } from '../../i18n';

const HIDE_ON = ['Login', 'Cart', 'Item', 'OrderPlaced', 'OrderDetail', 'CardDetails', 'PaymentMethods', 'Orders'];
const TAB_H = 62;

const WORDS = {
    placed: ['hourglass-outline', 'Waiting for the shop to accept'],
    accepted: ['checkmark-circle-outline', 'Accepted by the shop'],
    preparing: ['flame-outline', 'Being prepared'],
    ready: ['bag-check-outline', 'Ready'],
    out_for_delivery: ['bicycle', 'On the way'],
};

export default function ActiveOrderBar({ routeName, onOpen, onOpenAll }) {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && user.role !== 'rider' && user.role !== 'admin';
    const tracking = useLiveTripStore((s) => !!s.orderId && !!s.track);   // a delivery is being tracked: the tracking card (or its map) is the only thing shown
    const liveOffset = useLiveTripStore((s) => s.liveOffset);   // room taken above the tabs by the delivery bar: this bar sits above it
    const [orders, setOrders] = useState([]);
    const insets = useSafeAreaInsets();
    const { primary, text, muted, surface, border } = useBrand();
    const busy = useRef(false);
    const pulse = useRef(new Animated.Value(1)).current;
    const slide = useRef(new Animated.Value(0)).current;   // 0 = away, 1 = in place
    const lift = useRef(new Animated.Value(0)).current;    // pushed up above the delivery bar
    const away = useRef(new Animated.Value(0)).current;    // 1 = hidden by the customer (a small chip is left)
    const [hidden, setHidden] = useState(false);

    const load = useCallback(async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            const r = await fetchOrders({ active: true, limit: 5 });
            // an online order that was never paid is not an order in progress
            const live = (r.items || []).filter((o) => isActive(o.status) && o.orderType !== 'dine_in' && !(o.payment?.method && o.payment.method !== 'cod' && o.payment.status !== 'paid'));
            setOrders(live);
        } catch (e) { /* the bar stays as it was */ } finally { busy.current = false; }
    }, []);

    useEffect(() => {
        if (!enabled) { setOrders([]); return undefined; }
        load();
        const a = onOrderUpdate(load);
        const b = onNotification((n) => { if (n?.data?.orderId) load(); });
        const c = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        const t = setInterval(load, 60000);   // a safety net when a live message is missed
        return () => { a(); b(); c.remove(); clearInterval(t); };
    }, [enabled, load]);

    const first = orders[0];
    // One card only: when the live track bar is available (rider on the way), IT is the card (it has Track and Hide), so this one stays away
    const tableOpen = useTableBill((s) => !!s.bill?.open);   // dining in: the table bill bar is shown instead
    const show = enabled && !!first && !HIDE_ON.includes(routeName) && !tracking && liveOffset === 0 && !tableOpen;
    const orderKey = orders.map((o) => String(o.id || o._id)).join(',');
    useEffect(() => { setHidden(false); }, [orderKey]);   // a different set of orders: show the bar again
    useEffect(() => {
        Animated.timing(lift, { toValue: liveOffset, duration: 260, useNativeDriver: true }).start();
    }, [liveOffset, lift]);
    useEffect(() => {
        Animated.timing(away, { toValue: hidden ? 1 : 0, duration: 280, useNativeDriver: true }).start();
    }, [hidden, away]);

    useEffect(() => {
        Animated.timing(slide, { toValue: show ? 1 : 0, duration: 260, useNativeDriver: true }).start();
    }, [show, slide]);
    const setBarH = useLiveTripStore((s) => s.setBarH);
    useEffect(() => { setBarH(show && !hidden ? 76 : 0); return () => setBarH(0); }, [show, hidden, setBarH]);
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, [pulse]);

    if (!enabled || !first) return null;
    const many = orders.length > 1;
    const [icon, words] = WORDS[first.status] || ['receipt-outline', 'In progress'];
    const bottom = insets.bottom + TAB_H + 18;

    return (
        <>
        <Animated.View
            pointerEvents={show && !hidden ? 'box-none' : 'none'}
            style={{
                position: 'absolute', left: 12, right: 12, bottom,
                opacity: Animated.multiply(slide, away.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
                transform: [
                    { translateY: Animated.add(slide.interpolate({ inputRange: [0, 1], outputRange: [bottom + 90, 0] }), Animated.add(Animated.multiply(lift, -1), Animated.multiply(away, bottom + 90))) },
                ],
            }}
        >
            <Pressable
                onPress={() => (many ? onOpenAll() : onOpen(String(first.id || first._id)))}
                style={[s.bar, { backgroundColor: surface, borderColor: border }]}
                accessibilityRole="button" accessibilityLabel={tr('View your active order')}
            >
                <View style={[s.ic, { backgroundColor: tint(primary) }]}>
                    <Ionicons name={many ? 'receipt-outline' : icon} size={22} color={primary} />
                    <Animated.View style={[s.dot, { backgroundColor: primary, opacity: pulse }]} />
                </View>
                <View style={s.mid}>
                    <Text style={[s.head, { color: text }]} numberOfLines={1}>
                        {many ? tr('{n} orders in progress', { n: orders.length }) : tr('Order #{orderNo}', { orderNo: first.orderNo })}
                    </Text>
                    <Text style={[s.sub, { color: muted }]} numberOfLines={1}>{many ? tr('Tap to see them') : tr(words)}</Text>
                </View>
                <View style={[s.go, { backgroundColor: primary }]}>
                    <Text style={s.goTxt}>{tr('View')}</Text>
                    <Ionicons name="chevron-forward" size={15} color="#FFFFFF" />
                </View>
                <Pressable onPress={() => setHidden(true)} hitSlop={8} style={[s.hide, { backgroundColor: tint(primary) }]} accessibilityRole="button" accessibilityLabel={tr('Hide')}>
                    <Ionicons name="chevron-down" size={18} color={primary} />
                </Pressable>
            </Pressable>
        </Animated.View>
        {/* hidden: a small chip stays, to bring the bar back */}
        <Animated.View
            pointerEvents={show && hidden ? 'auto' : 'none'}
            style={{ position: 'absolute', right: 14, bottom, opacity: Animated.multiply(slide, away), transform: [{ translateY: Animated.add(Animated.multiply(lift, -1), away.interpolate({ inputRange: [0, 1], outputRange: [60, 0] })) }] }}
        >
            <Pressable onPress={() => setHidden(false)} style={[s.chip, { backgroundColor: primary }]} accessibilityRole="button" accessibilityLabel={tr('Show your active order')}>
                <Ionicons name="receipt-outline" size={20} color="#FFFFFF" />
                <Ionicons name="chevron-up" size={16} color="#FFFFFF" style={{ marginLeft: 2 }} />
            </Pressable>
        </Animated.View>
        </>
    );
}

const s = StyleSheet.create({
    bar: { minHeight: 60, borderRadius: 18, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    ic: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
    dot: { position: 'absolute', top: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#FFFFFF' },
    mid: { flex: 1, marginHorizontal: 12 },
    head: { fontSize: 15, fontWeight: '800' },
    sub: { fontSize: 12.5, fontWeight: '500', marginTop: 2 },
    hide: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
    chip: { height: 44, minWidth: 64, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
    go: { height: 34, borderRadius: 17, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 8 },
    goTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', marginRight: 2 },
});
