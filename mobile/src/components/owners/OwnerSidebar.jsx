// The owner panel on a computer (a browser at least 1024 px wide): a left sidebar instead of the floating bottom tabs and the hamburger menu.
//   - the five main pages (Home, Orders, Menu, Transactions, History) always on top, with the new-orders number on Orders
//   - everything else of the side menu (ShopMenu: Riders, Coupons, Staff, Money, Settings... with its search) under them
//   - a button folds the sidebar to a narrow icon column and back (remembered in this browser)
// Never drawn in the phone app or on a narrow window: DesktopFrame only mounts it when useOwnerDesktop() is true.
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../common/kit';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { ShopMenu } from '../../screens/owners/ShopHubScreen';
import { ShopLogo } from './ui';
import PlanChip from './PlanChip';
import BranchSwitcher from './BranchSwitcher';
import { tr } from '../../i18n';

const WIDE = 272;
const NARROW = 72;
const KEY = 'owner.sidebar.folded';

const MAIN = [
    ['HomeTab', 'Home', 'home-outline', 'home'],
    ['OrdersTab', 'Orders', 'receipt-outline', 'receipt'],
    ['MenuTab', 'Menu', 'restaurant-outline', 'restaurant'],
    ['TxTab', 'Transactions', 'wallet-outline', 'wallet'],
    ['HistoryTab', 'History', 'time-outline', 'time'],
];

const read = () => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const save = (v) => { try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* not saved */ } };

export default function OwnerSidebar({ routeName }) {
    const nav = useNavigation();
    const { background, surface, border, text, muted, primary, onPrimary, error } = useBrand();
    const [folded, setFolded] = useState(read);
    const waiting = useOwnerStore((st) => (st.live?.orders?.active?.placed || 0) + (st.live?.orders?.bulkWaiting || 0));
    const shopName = useHomeStore((s) => s.full.restaurant?.name);
    const themeName = useThemeStore((s) => s.theme.name);
    const user = useAuthStore((s) => s.user);
    const toggle = () => setFolded((f) => { save(!f); return !f; });
    const go = (name) => nav.navigate('MainTabs', { screen: name });

    return (
        <View style={{ width: folded ? NARROW : WIDE, backgroundColor: surface || background, borderRightWidth: 1, borderRightColor: border, height: '100%', transitionProperty: 'width', transitionDuration: '180ms' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: folded ? 0 : 16, paddingVertical: 16, justifyContent: folded ? 'center' : 'flex-start' }}>
                <ShopLogo size={folded ? 42 : 46} />
                {folded ? null : (
                    <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                        <Text style={{ color: text, fontSize: 17, fontWeight: '900' }} numberOfLines={1}>{shopName || themeName || tr('My shop')}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{user?.name || user?.phone || tr('Owner')}</Text>
                        <PlanChip compact />
                    </View>
                )}
            </View>
            <View style={{ paddingHorizontal: folded ? 10 : 12 }}>
                {MAIN.map(([name, label, icon, on]) => {
                    const here = routeName === name;
                    return (
                        <Pressable key={name} onPress={() => go(name)} accessibilityRole="button" accessibilityLabel={tr(label)}
                            style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: folded ? 'center' : 'flex-start', height: 46, borderRadius: 14, paddingHorizontal: folded ? 0 : 14, marginBottom: 4, cursor: 'pointer', backgroundColor: here ? primary : hovered ? border : 'transparent' })}>
                            <View>
                                <Ionicons name={here ? on : icon} size={22} color={here ? onPrimary : text} />
                                {folded && name === 'OrdersTab' && waiting > 0 ? <View style={{ position: 'absolute', top: -3, right: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: error }} /> : null}
                            </View>
                            {folded ? null : <Text style={{ flex: 1, marginLeft: 14, color: here ? onPrimary : text, fontSize: 15, fontWeight: '800' }}>{tr(label)}</Text>}
                            {!folded && name === 'OrdersTab' && waiting > 0 ? (
                                <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: here ? onPrimary : error, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ color: here ? primary : '#FFFFFF', fontSize: 12, fontWeight: '900' }}>{waiting}</Text>
                                </View>
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>
            <View style={{ height: 1, backgroundColor: border, marginHorizontal: 16, marginVertical: 10 }} />
            {folded ? (
                <View style={{ flex: 1, alignItems: 'center' }}>
                    <Pressable onPress={toggle} accessibilityLabel={tr('Show the full menu')} style={({ hovered }) => ({ width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: hovered ? border : 'transparent' })}>
                        <Ionicons name="apps-outline" size={22} color={text} />
                    </Pressable>
                </View>
            ) : (
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
                    <BranchSwitcher />
                    <ShopMenu />
                </ScrollView>
            )}
            <Pressable onPress={toggle} accessibilityLabel={folded ? tr('Open the sidebar') : tr('Fold the sidebar')}
                style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: folded ? 'center' : 'flex-start', height: 50, paddingHorizontal: folded ? 0 : 22, borderTopWidth: 1, borderTopColor: border, cursor: 'pointer', backgroundColor: hovered ? border : 'transparent' })}>
                <Ionicons name={folded ? 'chevron-forward' : 'chevron-back'} size={20} color={muted} />
                {folded ? null : <Text style={{ color: muted, fontSize: 13, fontWeight: '800', marginLeft: 10 }}>{tr('Fold sidebar')}</Text>}
            </Pressable>
        </View>
    );
}
