// The bar at the bottom while a BULK ORDER cart has dishes (the normal cart bar looks the same, but says BULK ORDER, so nobody mixes them up).
// Tapping it opens the bulk cart. Put it on the screens that have the normal cart bar, and on the bulk menu.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { useBulkCartStore } from '../../store/customers/useBulkCartStore';
import { tr } from '../../i18n';
import { useCustomerDesktop } from '../../utils/common/layout';

export default function BulkCartBar({ inFooter }) {
    const nav = useNavigation();
    const focused = useIsFocused();
    const insets = useSafeAreaInsets();
    const desk = useCustomerDesktop();   // the desktop website: a card in the bottom-right corner, the cart card's place (a bulk cart and a normal cart never exist together) (false in the phone app)
    const { primaryLight, primaryDark, onPrimary, radius } = useBrand();
    const dishes = useBulkCartStore((s) => s.lines.length);
    const pieces = useBulkCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    if (!dishes || !focused) return null;
    const r = Math.max(radius, 14);
    const bar = (
        <Pressable onPress={() => nav.navigate('BulkCart')} accessibilityRole="button" style={{ borderRadius: r }}>
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.in, { borderRadius: r }]}>
                <View style={s.icon}><Ionicons name="cube" size={18} color={onPrimary} /></View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 11.5, letterSpacing: 1, opacity: 0.9 }}>{tr('BULK ORDER')}</Text>
                    <Text style={{ color: onPrimary, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>{tr('{n} dishes · {p} pieces', { n: dishes, p: pieces })}</Text>
                </View>
                <Text style={{ color: onPrimary, fontWeight: '900' }}>{tr('View bulk cart')}</Text>
                <Ionicons name="chevron-forward" size={18} color={onPrimary} />
            </LinearGradient>
        </Pressable>
    );
    if (inFooter) return bar;
    if (desk) return <View pointerEvents="box-none" style={{ position: 'absolute', right: 24, bottom: 24, width: 400, zIndex: 60 }}>{bar}</View>;
    return <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 10) + 56, zIndex: 20 }}>{bar}</View>;
}

// On the normal Cart page (which is empty while a bulk cart is being filled): a way into the bulk cart, so the dishes he picked are never "lost"
export function BulkCartNotice() {
    const nav = useNavigation();
    const { primary, text, muted, onPrimary } = useBrand();
    const dishes = useBulkCartStore((s) => s.lines.length);
    const pieces = useBulkCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    if (!dishes) return null;
    return (
        <Pressable onPress={() => nav.navigate('BulkCart')} accessibilityRole="button" style={({ hovered }) => ({ marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 18, borderWidth: 1.5, borderColor: primary, backgroundColor: hovered ? primary + '2E' : primary + '1A', flexDirection: 'row', alignItems: 'center', cursor: 'pointer' })}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="cube" size={22} color={onPrimary} /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('You have a bulk order in progress')}</Text>
                <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{tr('{n} dishes · {p} pieces', { n: dishes, p: pieces })}</Text>
            </View>
            <Text style={{ color: primary, fontWeight: '900' }}>{tr('View bulk cart')}</Text>
            <Ionicons name="chevron-forward" size={18} color={primary} />
        </Pressable>
    );
}

const s = StyleSheet.create({
    in: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
    icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
});
