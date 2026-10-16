// The owner's side menu: slides in from the left when the hamburger is tapped. No dark layer over the page; a tap on the
// page beside it, or the Android back button, closes it.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, BackHandler, ScrollView, StyleSheet, Dimensions, StatusBar } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { useDrawer } from '../../store/owners/useDrawer';
import { useMotion } from '../common/motion';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { ShopMenu } from '../../screens/owners/ShopHubScreen';
import { ShopLogo } from './ui';

const WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.84));

export default function OwnerDrawer() {
    const insets = useSafeAreaInsets();
    // keep clear of the status bar and the phone's navigation bar, whichever way the phone reports them
    const top = Math.max(insets.top, StatusBar.currentHeight || 0);
    const bottom = insets.bottom;
    const { background, surface, border, text, muted } = useBrand();
    const motion = useMotion();
    const open = useDrawer((s) => s.open);
    const shopName = useHomeStore((s) => s.full.restaurant?.name);
    const themeName = useThemeStore((s) => s.theme.name);
    const name = shopName || themeName;
    const user = useAuthStore((s) => s.user);
    const x = useRef(new Animated.Value(-WIDTH)).current;
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        if (open) {
            setMounted(true);
            Animated.timing(x, { toValue: 0, duration: motion === 'off' ? 0 : 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        } else {
            Animated.timing(x, { toValue: -WIDTH, duration: motion === 'off' ? 0 : 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setMounted(false); });
        }
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open) return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => { useDrawer.getState().hide(); return true; });
        return () => sub.remove();
    }, [open]);

    if (!mounted && !open) return null;
    const close = () => useDrawer.getState().hide();

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {open ? <Pressable style={StyleSheet.absoluteFill} onPress={close} /> : null}
            <Animated.View
                style={{
                    position: 'absolute', top, bottom, left: 0, width: WIDTH, backgroundColor: background, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: border,
                    borderTopRightRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden', transform: [{ translateX: x }], elevation: 18, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 4, height: 0 },
                }}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }}>
                    <ShopLogo size={46} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>{name || 'My shop'}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{user?.name || user?.phone || 'Owner'}</Text>
                    </View>
                    <Pressable onPress={close} hitSlop={10}><Ionicons name="close" size={24} color={muted} /></Pressable>
                </View>
                <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
                    <ShopMenu onGo={close} />
                </ScrollView>
            </Animated.View>
        </View>
    );
}
