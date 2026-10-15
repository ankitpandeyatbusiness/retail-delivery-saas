import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Keyboard, StyleSheet, Platform, Dimensions, BackHandler } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef, CommonActions, StackActions } from '@react-navigation/native';
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
import { ToastHost, showToast } from '../components/customers/shop';
import { FrozenOverlay, OfflineBanner } from '../components/common/status';
import { useAppStatus } from '../store/common/useAppStatus';

const tb = StyleSheet.create({
    badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
    badgeTxt: { fontSize: 10, fontWeight: '800' },
    floatBar: {
        flexDirection: 'row', alignItems: 'center', height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth,
        shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
    },
    floatPill: { position: 'absolute', left: 0, top: 7, bottom: 7, borderRadius: 24 },
    // the highlight is exactly as wide as its tab (minus a small gap), so the last tab can never poke out of the bar
    floatItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    floatInner: { width: '100%', paddingHorizontal: 2, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
    floatBadge: { position: 'absolute', top: -6, right: -12 },
    floatLabel: { fontSize: 10.5, fontWeight: '700', marginTop: 3 },
});

// While a page is sliding in or out (the stack transition), a tab switch is NOT started on top of it: two
// transitions at once left the leaving page showing over the tab that slid in. The tap is kept and played the
// moment the page has finished moving (never more than half a second later).
const gate = { busy: false, pending: null, timer: null };
const holdGate = () => {
    gate.busy = true;
    clearTimeout(gate.timer);
    gate.timer = setTimeout(() => releaseGate(), 500);   // safety: never stay held
};
function releaseGate() {
    gate.busy = false;
    clearTimeout(gate.timer);
    const name = gate.pending;
    gate.pending = null;
    if (name && navigationRef.isReady()) navigationRef.dispatch(CommonActions.navigate({ name }));
}

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

// progress is -1 for a tab left of the open one, 0 for the open one, 1 for a tab to its right.
// The pages slide the FULL width, so a page that is not open is parked completely off the screen.
// (No opacity on purpose: on Android a card's shadow ignores its parent's opacity, so a "hidden" page that is
// parked on screen still shows its card shadows as a ghost. Off screen there is nothing to show.)
const slideScenes = ({ current }) => {
    const W = Dimensions.get('window').width + 24;   // a little extra so no shadow reaches the edge
    return {
        sceneStyle: {
            transform: [{ translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-W, 0, W] }) }],
        },
    };
};

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

// One tab: the icon (springs up when active), its label, and the cart count when there is one.
function TabItem({ focused, icon, label, badge, onPress, onLongPress }) {
    const { primary, muted } = useBrand();
    return (
        <Pressable onPress={onPress} onLongPress={onLongPress} style={tb.floatItem} accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}}>
            <View style={tb.floatInner}>
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
    const motion = useMotion();
    const [kb, setKb] = useState(false);
    const [w, setW] = useState(0);
    const slide = useRef(new Animated.Value(state.index)).current;
    useEffect(() => {
        if (motion === 'off') { slide.setValue(state.index); return; }
        // same duration and curve as the page slide, so the highlight and the page arrive together
        Animated.timing(slide, { toValue: state.index, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [state.index, motion, slide]);

    useEffect(() => {
        const a = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKb(true));
        const b = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKb(false));
        return () => { a.remove(); b.remove(); };
    }, []);

    if (kb) return null;
    return (
        <View style={{ backgroundColor: background, paddingHorizontal: 14, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4 }}>
            <View
                onLayout={(e) => setW(e.nativeEvent.layout.width)}
                style={[tb.floatBar, { backgroundColor: surface, borderColor: border, shadowColor: dark ? '#000000' : primary }]}
            >
                {/* exactly as wide as one tab (minus a small gap), so it can never poke out of the bar */}
                {w ? (
                    <Animated.View
                        pointerEvents="none"
                        style={[tb.floatPill, {
                            width: w / state.routes.length - 10,
                            backgroundColor: alpha(primary, 0.14),
                            transform: [{ translateX: Animated.add(Animated.multiply(slide, w / state.routes.length), 5) }],
                        }]}
                    />
                ) : null}
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
    const tabMotion = useMotion();
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
            backBehavior="initialRoute"
            screenListeners={({ route }) => ({
                tabPress: (e) => {
                    if (gate.busy) { e.preventDefault(); gate.pending = route.name; }
                },
            })}
            tabBar={floating ? (props) => <FloatingTabBar {...props} defs={defsByRoute} /> : undefined}
            screenOptions={{
                headerShown: false,
                sceneStyle: { backgroundColor: background },
                tabBarHideOnKeyboard: true,
                animation: tabMotion === 'off' ? 'none' : 'shift',
                sceneStyleInterpolator: tabMotion === 'off' ? undefined : slideScenes,
                transitionSpec: { animation: 'timing', config: { duration: 300, easing: Easing.out(Easing.cubic) } },
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

// Android back button, in three steps:
//   1. pages (Item, Cart, Order detail...) go back one page, as the stack already does;
//   2. on any other tab, Back goes to the Home tab (the tabs' backBehavior is "initialRoute");
//   3. on Home, the first Back shows "Press back again to exit" and a second one within 2 seconds leaves the app.
function useDoubleBackExit() {
    const last = useRef(0);
    useEffect(() => {
        if (Platform.OS !== 'android') return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (!navigationRef.isReady()) return false;
            if (navigationRef.getCurrentRoute()?.name !== 'Home') return false;   // not the Home tab: normal behaviour
            const now = Date.now();
            if (now - last.current < 2000) { BackHandler.exitApp(); return true; }
            last.current = now;
            showToast('Press back again to exit');
            return true;
        });
        return () => sub.remove();
    }, []);
}

export default function AppNavigator() {
    useDoubleBackExit();
    const isHydrated = useAuthStore((s) => s.isHydrated);
    const { background, surface, border, primary, text, dark } = useBrand();
    // The default navigation theme is white: it showed as a white bar behind the tabs while they slid, in dark mode.
    const navTheme = React.useMemo(() => ({
        ...DefaultTheme,
        dark: !!dark,
        colors: { ...DefaultTheme.colors, background, card: surface, border, primary, text: text || DefaultTheme.colors.text },
    }), [background, surface, border, primary, text, dark]);
    const motion = useMotion();   // the shop's Animations setting (and the phone's reduce-motion) can turn transitions off
    const slide = motion === 'off' ? 'none' : 'slide_from_right';
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
        <View style={{ flex: 1, backgroundColor: background }}>
            <NavigationContainer ref={navigationRef} onReady={navigationReady} theme={navTheme}>
                <Stack.Navigator
                    screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background }, animation: slide, animationDuration: 220, gestureEnabled: true }}
                    screenListeners={{ transitionStart: holdGate, transitionEnd: releaseGate }}
                    initialRouteName={user ? 'MainTabs' : 'Login'}
                >
                    {/* LoginScreen is untouched. Its Skip / success go to "MainTabs" */}
                    <Stack.Screen name="Login" component={LoginScreen} options={{ animation: motion === 'off' ? 'none' : 'fade' }} />
                    <Stack.Screen name="MainTabs" component={Landing} />

                    {/* full-screen pages (back arrow top left) */}
                    {/* a dish rises from the bottom, like opening a card */}
                    <Stack.Screen name="Item" component={ItemScreen} options={{ animation: motion === 'off' ? 'none' : 'fade_from_bottom', animationDuration: 260 }} />
                    <Stack.Screen name="Cart" component={CartScreen} options={{ animation: motion === 'off' ? 'none' : 'slide_from_bottom', animationDuration: 260 }} />
                    <Stack.Screen name="Offers" component={OffersScreen} />
                    <Stack.Screen name="Bestsellers" component={BestsellersScreen} />
                    <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
                    <Stack.Screen name="CardDetails" component={CardDetailsScreen} />
                    <Stack.Screen name="Favourites" component={FavouritesScreen} />
                    <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
                    <Stack.Screen name="OrderPlaced" component={OrderPlacedScreen} options={{ gestureEnabled: false, animation: motion === 'off' ? 'none' : 'fade', animationDuration: 300 }} />
                    <Stack.Screen name="Notifications" component={NotificationsScreen} />
                </Stack.Navigator>
            </NavigationContainer>
            <FrozenOverlay onOrders={goOrders} />
            <OfflineBanner />
            <ToastHost />
        </View>
    );
}