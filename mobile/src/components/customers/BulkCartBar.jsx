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

export default function BulkCartBar({ inFooter }) {
    const nav = useNavigation();
    const focused = useIsFocused();
    const insets = useSafeAreaInsets();
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
    return <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 10) + 56, zIndex: 20 }}>{bar}</View>;
}

const s = StyleSheet.create({
    in: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
    icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
});
