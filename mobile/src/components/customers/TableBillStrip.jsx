// While he is dining in: a bar above the tabs, "Table 7 · 3 rounds · ₹640 so far". Tap it for the whole bill. It keeps itself up to date.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, AppState, Animated, Easing, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useCartStore } from '../../store/customers/shopStores';
import { useTableBill } from '../../store/customers/useTableBill';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';

const TAB_H = 62;
const HIDE_ON = ['TableBill', 'Cart', 'Item', 'OrderPlaced'];

export default function TableBillStrip({ routeName, onOpen }) {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && ['rider', 'admin', 'kitchen', 'waiter'].indexOf(user.role) < 0;
    const bill = useTableBill((s) => s.bill);
    const cartCount = useCartStore((s) => s.lines.length);   // the "View cart" bar sits in the same place, so this bar steps aside for it
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, error } = useBrand();
    const [hidden, setHidden] = useState(false);   // he hid the bar: a small chip stays to bring it back
    const [barH, setBarH] = useState(60);   // the round chip is as tall as the bar
    const away = useRef(new Animated.Value(0)).current;   // 0 = bar shown, 1 = hidden
    useEffect(() => { Animated.timing(away, { toValue: hidden ? 1 : 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [hidden, away]);
    const key = `${bill?.table}|${bill?.status}`;
    useEffect(() => { setHidden(false); }, [key]);   // another table, or the bill was asked: show the bar again

    useEffect(() => {
        if (!enabled) { useTableBill.getState().reset(); return undefined; }
        const load = () => useTableBill.getState().load();
        load();
        const t = setInterval(load, bill?.open ? 15000 : 60000);
        const a = onNotification(load);
        const b = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => { clearInterval(t); a(); b.remove(); };
    }, [enabled, bill?.open]);

    if (!enabled || !bill?.open || HIDE_ON.includes(routeName) || (cartCount > 0 && routeName === 'Home')) return null;
    const asked = bill.status === 'bill_asked';
    const rounds = bill.rounds.length;
    const bottom = insets.bottom + TAB_H + 18;
    return (
        <>
        <Animated.View pointerEvents={hidden ? 'none' : 'auto'} style={{ position: 'absolute', left: 12, right: 12, bottom, opacity: away.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: away.interpolate({ inputRange: [0, 1], outputRange: [0, Dimensions.get('window').width] }) }] }}>
        <Pressable
            onPress={onOpen}
            onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0 && h !== barH) setBarH(h); }}
            style={{ borderRadius: 18, backgroundColor: asked ? error : primary, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', elevation: 8 }}
        >
            <Ionicons name={asked ? 'receipt' : 'restaurant'} size={20} color={onPrimary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: onPrimary, fontWeight: '900' }} numberOfLines={1}>
                    {asked ? tr('Bill asked · Table {t}', { t: bill.table }) : tr('Table {t} · {n} so far', { t: bill.table, n: `₹${Math.round(bill.total)}` })}
                </Text>
                <Text style={{ color: onPrimary, opacity: 0.85, fontSize: 12 }} numberOfLines={1}>
                    {asked ? tr('The shop is on its way') : rounds === 1 ? tr('1 round') : tr('{n} rounds', { n: rounds })}
                </Text>
            </View>
            <Ionicons name="chevron-up" size={20} color={onPrimary} />
            <Pressable onPress={() => setHidden(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Hide')}
                style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginLeft: 8, backgroundColor: 'rgba(255,255,255,0.22)' }}>
                <Ionicons name="chevron-down" size={18} color={onPrimary} />
            </Pressable>
        </Pressable>
        </Animated.View>
        <Animated.View pointerEvents={hidden ? 'auto' : 'none'} style={{ position: 'absolute', right: 12, bottom, opacity: away, transform: [{ translateX: away.interpolate({ inputRange: [0, 1], outputRange: [70, 0] }) }, { rotate: away.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '0deg'] }) }] }}>
            <Pressable onPress={() => setHidden(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Show')}
                style={{ width: barH, height: barH, borderRadius: barH / 2, backgroundColor: asked ? error : primary, alignItems: 'center', justifyContent: 'center', elevation: 8 }}>
                <Ionicons name={asked ? 'receipt' : 'restaurant'} size={Math.round(barH * 0.42)} color={onPrimary} />
            </Pressable>
        </Animated.View>
        </>
    );
}
