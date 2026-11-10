// The DESKTOP website for customers (a browser at least 1024 px wide): a top bar (the shop, links, search, cart, account), the screens in a
// centred column, and on the menu a live cart panel on the right (like Zomato / Swiggy on a computer).
// The phone, the phone browser, tablets and the native app never reach this: useCustomerDesktop() is false there and the children are returned as they are.
import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useCartStore } from '../../store/customers/shopStores';
import { useCustomerDesktop, DESKTOP_PAGE_MAX, DESKTOP_PANEL } from '../../utils/common/layout';
import { tr } from '../../i18n';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const PAGE = DESKTOP_PAGE_MAX;
const PANEL = DESKTOP_PANEL;

const LINKS = [
    { label: 'Home', tab: 'Home' },
    { label: 'Orders', tab: 'Orders' },
    { label: 'Account', tab: 'Account' },
];

function TopBar({ navRef, routeName }) {
    const brand = useBrand();
    const { theme } = useThemeStore();
    const user = useAuthStore((s) => s.user);
    const count = useCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    const go = (name, params) => { if (navRef && navRef.isReady()) navRef.navigate(name, params); };
    const logo = theme.icon || theme.logo;

    return (
        <View style={{ backgroundColor: brand.surface, borderBottomWidth: 1, borderBottomColor: brand.border, zIndex: 20 }}>
            <View style={{ width: '100%', maxWidth: PAGE, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', height: 68, paddingHorizontal: 24 }}>
                <Pressable onPress={() => go('MainTabs', { screen: 'Home' })} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 28 }}>
                    {logo ? <Image source={logo} style={{ width: 38, height: 38, borderRadius: 10, marginRight: 10, backgroundColor: brand.background }} contentFit="cover" /> : null}
                    <Text numberOfLines={1} style={{ color: brand.text, fontSize: 19, fontWeight: '900', maxWidth: 260 }}>{theme.name || 'Shop'}</Text>
                </Pressable>

                {LINKS.map((l) => {
                    const on = routeName === l.tab;
                    return (
                        <Pressable key={l.tab} onPress={() => go('MainTabs', { screen: l.tab })} style={{ paddingHorizontal: 12, paddingVertical: 8, marginRight: 4, cursor: 'pointer' }}>
                            <Text style={{ color: on ? brand.primary : brand.muted, fontWeight: on ? '900' : '700', fontSize: 15 }}>{tr(l.label)}</Text>
                        </Pressable>
                    );
                })}

                <Pressable onPress={() => go('Search')} style={{ flex: 1, maxWidth: 440, marginLeft: 24, flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: brand.background, borderWidth: 1, borderColor: brand.border, cursor: 'pointer' }}>
                    <Ionicons name="search" size={17} color={brand.muted} style={{ marginRight: 8 }} />
                    <Text numberOfLines={1} style={{ color: brand.muted, fontSize: 14 }}>{tr('Search for dishes')}</Text>
                </Pressable>

                <View style={{ flex: 1 }} />

                <Pressable onPress={() => go('Cart')} style={{ flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 16, borderRadius: 21, borderWidth: 1, borderColor: brand.border, marginRight: 12, cursor: 'pointer' }}>
                    <Ionicons name="bag-handle-outline" size={19} color={brand.text} />
                    <Text style={{ color: brand.text, fontWeight: '800', marginLeft: 8 }}>{tr('Cart')}</Text>
                    {count > 0 ? (
                        <View style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 8, paddingHorizontal: 5 }}>
                            <Text style={{ color: brand.onPrimary || '#FFFFFF', fontSize: 12, fontWeight: '900' }}>{count}</Text>
                        </View>
                    ) : null}
                </Pressable>

                {user ? (
                    <Pressable onPress={() => go('MainTabs', { screen: 'Account' })} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Text style={{ color: brand.onPrimary || '#FFFFFF', fontWeight: '900', fontSize: 16 }}>{String(user.name || user.phone || '?').trim().slice(0, 1).toUpperCase()}</Text>
                    </Pressable>
                ) : (
                    <Pressable onPress={() => go('Login')} style={{ height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <Text style={{ color: brand.onPrimary || '#FFFFFF', fontWeight: '800' }}>{tr('Log in')}</Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

function CartPanel({ navRef }) {
    const brand = useBrand();
    const lines = useCartStore((s) => s.lines);
    const total = lines.reduce((a, l) => a + l.price * l.quantity, 0);
    const go = (name) => { if (navRef && navRef.isReady()) navRef.navigate(name); };

    return (
        <View style={{ width: PANEL, borderLeftWidth: 1, borderLeftColor: brand.border, backgroundColor: brand.surface }}>
            <View style={{ padding: 20, paddingBottom: 12 }}>
                <Text style={{ color: brand.text, fontSize: 20, fontWeight: '900' }}>{tr('Your cart')}</Text>
            </View>
            {lines.length === 0 ? (
                <View style={{ alignItems: 'center', padding: 36 }}>
                    <Ionicons name="bag-handle-outline" size={46} color={brand.muted} />
                    <Text style={{ color: brand.text, fontWeight: '800', fontSize: 16, marginTop: 12 }}>{tr('Your cart is empty')}</Text>
                    <Text style={{ color: brand.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>{tr('Add dishes from the menu and they show up here.')}</Text>
                </View>
            ) : (
                <>
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
                        {lines.map((l) => (
                            <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: brand.border }}>
                                <View style={{ width: 14, height: 14, borderWidth: 1.5, borderColor: l.isVeg === false ? '#B3261E' : '#2E7D32', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: l.isVeg === false ? '#B3261E' : '#2E7D32' }} />
                                </View>
                                <View style={{ flex: 1, paddingRight: 8 }}>
                                    <Text numberOfLines={2} style={{ color: brand.text, fontWeight: '700', fontSize: 14 }}>{l.name}</Text>
                                    {l.optionsText ? <Text numberOfLines={1} style={{ color: brand.muted, fontSize: 12, marginTop: 2 }}>{l.optionsText}</Text> : null}
                                    <Text style={{ color: brand.text, fontSize: 13, fontWeight: '700', marginTop: 3 }}>{money(l.price * l.quantity)}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: brand.primary, borderRadius: 10, overflow: 'hidden' }}>
                                    <Pressable onPress={() => useCartStore.getState().setQty(l.key, l.quantity - 1)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                        <Ionicons name={l.quantity <= 1 ? 'trash-outline' : 'remove'} size={16} color={brand.primary} />
                                    </Pressable>
                                    <Text style={{ minWidth: 24, textAlign: 'center', color: brand.text, fontWeight: '900' }}>{l.quantity}</Text>
                                    <Pressable onPress={() => useCartStore.getState().setQty(l.key, l.quantity + 1)} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                        <Ionicons name="add" size={16} color={brand.primary} />
                                    </Pressable>
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                    <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: brand.border }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ color: brand.muted, fontSize: 14 }}>{tr('Subtotal')}</Text>
                            <Text style={{ color: brand.text, fontWeight: '900', fontSize: 16 }}>{money(total)}</Text>
                        </View>
                        <Text style={{ color: brand.muted, fontSize: 12, marginBottom: 14 }}>{tr('Delivery and taxes are worked out at checkout.')}</Text>
                        <Pressable onPress={() => go('Cart')} style={{ height: 50, borderRadius: 14, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                            <Text style={{ color: brand.onPrimary || '#FFFFFF', fontWeight: '900', fontSize: 16 }}>{tr('Checkout')}</Text>
                        </Pressable>
                    </View>
                </>
            )}
        </View>
    );
}

// The wrappers are the SAME on every screen size, only the top bar and the cart panel come and go: resizing the window (or moving between the
// login screen and the rest) must never rebuild the navigator inside, or the customer would lose the place they were in.
export default function DesktopFrame({ navRef, routeName, children }) {
    const desktop = useCustomerDesktop();
    const brand = useBrand();
    const bare = !desktop || routeName === 'Login';   // the login screen has its own full-width desktop layout
    const showCart = desktop && routeName === 'Home';
    return (
        <View style={{ flex: 1, backgroundColor: desktop ? brand.background : undefined }}>
            {bare ? null : <TopBar navRef={navRef} routeName={routeName} />}
            <View style={{ flex: 1, flexDirection: 'row', width: '100%', maxWidth: bare ? undefined : PAGE, alignSelf: 'center' }}>
                <View style={{ flex: 1, overflow: bare ? undefined : 'hidden' }}>{children}</View>
                {showCart ? <CartPanel navRef={navRef} /> : null}
            </View>
        </View>
    );
}
