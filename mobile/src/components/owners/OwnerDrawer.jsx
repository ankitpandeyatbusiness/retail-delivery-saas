// The owner's side menu: slides in from the left when the hamburger is tapped. No dark layer over the page; a tap on the
// page beside it, the Android back button, or a swipe towards the left (on the menu or on the page beside it) closes it.
import { usePlanHas } from '../../utils/owners/menuFlags';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, BackHandler, ScrollView, StyleSheet, Dimensions, StatusBar, PanResponder } from 'react-native';
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
import MenuIndexStrip, { useMenuIndex } from './MenuIndexStrip';
import { ShopLogo } from './ui';
import BranchSwitcher from './BranchSwitcher';
import { tr } from '../../i18n';
import { useAppStatus } from '../../store/common/useAppStatus';

const WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.84));

export default function OwnerDrawer() {
    const branchesOk = usePlanHas('multiBranch');   // Pro
    const insets = useSafeAreaInsets();
    // keep clear of the status bar and the phone's navigation bar, whichever way the phone reports them
    // While the maintenance bar shows, the bar already covers the status bar and the app below it starts under the bar: the menu starts at the top of that area.
    const barOn = useAppStatus((s) => !!s.maintenance);
    const top = barOn ? 0 : Math.max(insets.top, StatusBar.currentHeight || 0);
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
    const menuScroll = useRef(null);   // the menu's scroll view: the A to Z strip scrolls it (a hook: it must come before the return below)

    useEffect(() => {
        if (open) {
            setMounted(true);
            Animated.timing(x, { toValue: 0, duration: motion === 'off' ? 0 : 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        } else {
            Animated.timing(x, { toValue: -WIDTH, duration: motion === 'off' ? 0 : 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) setMounted(false); });
        }
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    // a swipe towards the left: the menu follows the finger, and goes away when it has been pulled far enough (or flicked); else it springs back
    const pan = useRef(PanResponder.create({
        // only a mostly sideways move to the left (a vertical move still scrolls the menu)
        onMoveShouldSetPanResponderCapture: (_, g) => g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderGrant: () => { x.stopAnimation(); },
        onPanResponderMove: (_, g) => { x.setValue(Math.min(0, g.dx)); },
        onPanResponderRelease: (_, g) => {
            if (g.dx < -WIDTH * 0.3 || g.vx < -0.6) {
                Animated.timing(x, { toValue: -WIDTH, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => useDrawer.getState().hide());
            } else {
                Animated.spring(x, { toValue: 0, friction: 9, tension: 120, useNativeDriver: true }).start();
            }
        },
        onPanResponderTerminate: () => { Animated.spring(x, { toValue: 0, friction: 9, tension: 120, useNativeDriver: true }).start(); },
    })).current;

    useEffect(() => {
        if (!open) return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => { useDrawer.getState().hide(); return true; });
        return () => sub.remove();
    }, [open]);

    if (!mounted && !open) return null;
    const close = () => useDrawer.getState().hide();

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {open ? <View style={StyleSheet.absoluteFill} {...pan.panHandlers}><Pressable style={{ flex: 1 }} onPress={close} /></View> : null}
            <Animated.View
                {...pan.panHandlers}
                style={{
                    position: 'absolute', top, bottom, left: 0, width: WIDTH, backgroundColor: background, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: border,
                    borderTopRightRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden', transform: [{ translateX: x }], elevation: 18, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 4, height: 0 },
                }}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }}>
                    <ShopLogo size={46} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>{name || tr('My shop')}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{user?.name || user?.phone || tr('Owner')}</Text>
                    </View>
                    <Pressable onPress={close} hitSlop={10}><Ionicons name="close" size={24} color={muted} /></Pressable>
                </View>
                <ScrollView ref={menuScroll} scrollEventThrottle={16} onScroll={(e) => useMenuIndex.getState().setScroll(e.nativeEvent.contentOffset.y)} contentContainerStyle={{ paddingTop: 8, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
                    {branchesOk ? <BranchSwitcher onGo={close} /> : null}
                    <ShopMenu onGo={close} />
                </ScrollView>
                <MenuIndexStrip scrollRef={menuScroll} top={84} bottom={24} pad={8} />
            </Animated.View>
        </View>
    );
}
