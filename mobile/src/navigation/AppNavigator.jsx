import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Keyboard, StyleSheet, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, CommonActions, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoginScreen from '../screens/common/LoginScreen';
import HomeScreen from '../screens/customers/HomeScreen';
import ItemScreen from '../screens/customers/ItemScreen';
import CartScreen from '../screens/customers/CartScreen';
import SearchScreen from '../screens/customers/SearchScreen';
import PaymentMethodsScreen from '../screens/customers/PaymentMethodsScreen';
import OrdersScreen from '../screens/customers/OrdersScreen';
import OrderDetailScreen from '../screens/customers/OrderDetailScreen';
import OrderPlacedScreen from '../screens/customers/OrderPlacedScreen';
import RiderHomeScreen from '../screens/riders/RiderHomeScreen';
import CardDetailsScreen from '../screens/customers/CardDetailsScreen';
import NotificationsScreen from '../screens/common/NotificationsScreen';
import { bindNavigation, navigationReady } from '../utils/common/push';
import AccountScreen from '../screens/customers/AccountScreen';
import { OffersScreen, BestsellersScreen, FavouritesScreen } from '../screens/customers/OffersScreen';
import { useAuthStore } from '../store/common/useAuthStore';
import { useHomeStore } from '../store/customers/useHomeStore';
import { useCartStore } from '../store/customers/shopStores';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../components/common/kit';
import { useMotion } from '../components/common/motion';
import { useThemeStore } from '../store/common/useThemeStore';
import { ToastHost } from '../components/customers/shop';
import { FrozenOverlay, OfflineBanner } from '../components/common/status';
import { useAppStatus } from '../store/common/useAppStatus';

const tb = StyleSheet.create({
    badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
    badgeTxt: { fontSize: 10, fontWeight: '800' },
    floatBar: {
        flexDirection: 'row', alignItems: 'center', height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth,
        shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
    },
    floatPill: { borderRadius: 22 },
    // the highlight is exactly as wide as its tab (minus a small gap), so the last tab can never poke out of the bar
    floatItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    floatInner: { width: '100%', paddingHorizontal: 2, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
    floatBadge: { position: 'absolute', top: -6, right: -12 },
    floatLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 3 },
});

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
bindNavigation(navigationRef);


// config tab id -> screen. Unknown ids from the server are skipped.
const TAB_DEFS = {
    home: { name: 'Home', label: 'Home', icon: 'home', component: HomeScreen },
    search: { name: 'Search', label: 'Search', icon: 'search', component: SearchScreen },
    orders: { name: 'Orders', label: 'Orders', icon: 'receipt', component: OrdersScreen },
    cart: { name: 'CartTab', label: 'Cart', icon: 'cart', component: CartScreen },
    profile: { name: 'Account', label: 'Account', icon: 'person', component: AccountScreen },
};
const DEFAULT_TABS = ['home', 'search', 'orders', 'profile'];

// the icon springs up a little when its tab becomes active
function TabGlyph({ focused, color, icon, size = 22 }) {
    const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
    const motion = useMotion();
    useEffect(() => {
        if (motion === 'off') { v.setValue(focused ? 1 : 0); return; }
        Animated.spring(v, { toValue: focused ? 1 : 0, friction: 5, tension: 170, useNativeDriver: true }).start();
    }, [focused, motion, v]);
    return (
        <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }}>
            <Ionicons name={focused ? icon : `${icon}-outline`} size={size} color={color} />
        </Animated.View>
    );
}

// the cart count: pops each time the number changes
function CountBadge({ n }) {
    const { primary, onPrimary } = useBrand();
    const v = useRef(new Animated.Value(1)).current;
    const last = useRef(n);
    useEffect(() => {
        if (last.current !== n && n > 0) {
            v.setValue(0.6);
            Animated.spring(v, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();
        }
        last.current = n;
    }, [n, v]);
    if (!n) return null;
    return (
        <Animated.View style={[tb.badge, { backgroundColor: primary, transform: [{ scale: v }] }]}>
            <Text style={[tb.badgeTxt, { color: onPrimary }]}>{n > 9 ? '9+' : n}</Text>
        </Animated.View>
    );
}

// The highlight sits INSIDE the tab, around the icon and its label together, so it always covers both
// (it grows with the content, never a fixed circle that the text can spill out of).
function TabItem({ focused, icon, label, badge, onPress, onLongPress }) {
    const { primary, muted } = useBrand();
    const motion = useMotion();
    const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
    useEffect(() => {
        if (motion === 'off') { v.setValue(focused ? 1 : 0); return; }
        Animated.timing(v, { toValue: focused ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [focused, motion, v]);
    return (
        <Pressable onPress={onPress} onLongPress={onLongPress} style={tb.floatItem} accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}}>
            <View style={tb.floatInner}>
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, tb.floatPill, { backgroundColor: alpha(primary, 0.14), opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}
                />
                <View>
                    <TabGlyph focused={focused} color={focused ? primary : muted} icon={icon || 'ellipse'} />
                    {typeof badge === 'number' ? <View style={tb.floatBadge}><CountBadge n={badge} /></View> : null}
                </View>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[tb.floatLabel, { color: focused ? primary : muted }]}>{label}</Text>
            </View>
        </Pressable>
    );
}

// A rounded bar that floats above the screen.
function FloatingTabBar({ state, descriptors, navigation, defs }) {
    const insets = useSafeAreaInsets();
    const { primary, background, surface, border, dark } = useBrand();
    const [kb, setKb] = useState(false);

    useEffect(() => {
        const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
        const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
        return () => { a.remove(); b.remove(); };
    }, []);

    if (kb) return null;
    return (
        <View style={{ backgroundColor: background, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4 }}>
            <View style={[tb.floatBar, { backgroundColor: surface, borderColor: border, shadowColor: dark ? '#000000' : primary }]}>
                {state.routes.map((route, i) => {
                    const focused = state.index === i;
                    const d = defs[route.name] || {};
                    const onPress = () => {
                        const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
                    };
                    return (
                        <TabItem
                            key={route.key}
                            focused={focused}
                            icon={d.icon}
                            label={d.label || route.name}
                            badge={descriptors[route.key].options.tabBarBadge}
                            onPress={onPress}
                            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                        />
                    );
                })}
            </View>
        </View>
    );
}

function MainTabs() {
    const insets = useSafeAreaInsets();
    const { primary, background, border, muted } = useBrand();
    const load = useHomeStore((s) => s.load);
    const tabsCfg = useHomeStore((s) => s.full.tabs);
    const count = useCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    const floating = useThemeStore((s) => s.theme.tabBarStyle) === 'floating';
    const defsByRoute = Object.fromEntries(Object.values(TAB_DEFS).map((d) => [d.name, d]));

    // one place loads the shop config for the whole app
    useEffect(() => { load(); }, [load]);

    let ids = (tabsCfg || []).filter((id) => TAB_DEFS[id]);
    if (ids.length < 2 || !ids.includes('home')) ids = DEFAULT_TABS;
    ids = ids.filter((id) => id !== 'cart');
    ids.splice(Math.min(2, ids.length), 0, 'cart');

    return (
        <Tab.Navigator
            initialRouteName="Home"
            tabBar={floating ? (props) => <FloatingTabBar {...props} defs={defsByRoute} /> : undefined}
            screenOptions={{
                headerShown: false,
                tabBarHideOnKeyboard: true,
                tabBarActiveTintColor: primary,
                tabBarInactiveTintColor: muted,
                tabBarStyle: {
                    height: 62 + insets.bottom,
                    paddingBottom: insets.bottom + 6,
                    paddingTop: 8,
                    backgroundColor: background,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: border,
                    ...(Platform.OS === 'android'
                        ? { elevation: 0 }
                        : {
                            shadowColor: '#000000',
                            shadowOpacity: 0.08,
                            shadowRadius: 10,
                            shadowOffset: { width: 0, height: -3 },
                        }),
                },
                tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
            }}
        >
            {ids.map((id) => {
                const d = TAB_DEFS[id];
                return (
                    <Tab.Screen
                        key={id}
                        name={d.name}
                        component={d.component}
                        options={{
                            tabBarLabel: d.label,
                            tabBarBadge: id === 'cart' && count > 0 ? count : undefined,
                            tabBarIcon: ({ focused, color }) => (
                                <View style={{ width: 58, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? alpha(primary, 0.14) : 'transparent' }}>
                                    <TabGlyph focused={focused} color={color} icon={d.icon} />
                                </View>
                            ),
                        }}
                    />
                );
            })}
        </Tab.Navigator>
    );
}

// A user with role "rider" gets the delivery screen instead of the shop tabs (same app, same login).
function Landing() {
    const role = useAuthStore((s) => s.user?.role);
    return role === 'rider' ? <RiderHomeScreen /> : <MainTabs />;
}

export default function AppNavigator() {
    const isHydrated = useAuthStore((s) => s.isHydrated);
    const user = useAuthStore((s) => s.user);
    const hadUser = useRef(false);

    // "My orders" on the frozen screen: back to the tabs (no reload) and open Orders
    const goOrders = () => {
        useAppStatus.getState().clearFrozen();
        if (!navigationRef.isReady()) return;
        navigationRef.dispatch(StackActions.popToTop());
        navigationRef.dispatch(CommonActions.navigate({ name: 'Orders' }));
    };

    // (The saved session is restored by App.js before this screen is ever drawn.)

    // Signed-in user became signed-out (logout, or refresh token rejected): back to Login.
    //    Guests who tapped "Skip" never had a user, so they are not affected.
    useEffect(() => {
        if (!isHydrated) return;
        if (hadUser.current && !user && navigationRef.isReady()) {
            navigationRef.resetRoot({ index: 0, routes: [{ name: 'Login' }] });
        }
        hadUser.current = !!user;
    }, [isHydrated, user]);

    if (!isHydrated) return null;   // App.js keeps the native splash screen up until this is true

    return (
        <View style={{ flex: 1 }}>
            <NavigationContainer ref={navigationRef} onReady={navigationReady}>
                <Stack.Navigator
                    screenOptions={{ headerShown: false }}
                    initialRouteName={user ? 'MainTabs' : 'Login'}
                >
                    {/* LoginScreen is untouched. Its Skip / success go to "MainTabs" */}
                    <Stack.Screen name="Login" component={LoginScreen} />
                    <Stack.Screen name="MainTabs" component={Landing} />

                    {/* full-screen pages (back arrow top left) */}
                    <Stack.Screen name="Item" component={ItemScreen} />
                    <Stack.Screen name="Cart" component={CartScreen} />
                    <Stack.Screen name="Offers" component={OffersScreen} />
                    <Stack.Screen name="Bestsellers" component={BestsellersScreen} />
                    <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
                    <Stack.Screen name="CardDetails" component={CardDetailsScreen} />
                    <Stack.Screen name="Favourites" component={FavouritesScreen} />
                    <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
                    <Stack.Screen name="OrderPlaced" component={OrderPlacedScreen} options={{ gestureEnabled: false, animation: 'fade' }} />
                    <Stack.Screen name="Notifications" component={NotificationsScreen} />
                </Stack.Navigator>
            </NavigationContainer>
            <FrozenOverlay onOrders={goOrders} />
            <OfflineBanner />
            <ToastHost />
        </View>
    );
}