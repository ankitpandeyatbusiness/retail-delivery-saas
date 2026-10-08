import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View, StyleSheet,Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, CommonActions, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import ItemScreen from '../screens/ItemScreen';
import CartScreen from '../screens/CartScreen';
import SearchScreen from '../screens/SearchScreen';
import PaymentMethodsScreen from '../screens/PaymentMethodsScreen';
import OrdersScreen from '../screens/OrdersScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import AccountScreen from '../screens/AccountScreen';
import { OffersScreen, BestsellersScreen, FavouritesScreen } from '../screens/OffersScreen';
import { useAuthStore } from '../store/useAuthStore';
import { useHomeStore } from '../store/useHomeStore';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../components/ui/kit';
import { ToastHost } from '../components/ui/shop';
import { FrozenOverlay, OfflineBanner } from '../components/ui/status';
import { useAppStatus } from '../store/useAppStatus';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();


// config tab id -> screen. Unknown ids from the server are skipped.
const TAB_DEFS = {
    home: { name: 'Home', label: 'Home', icon: 'home', component: HomeScreen },
    search: { name: 'Search', label: 'Search', icon: 'search', component: SearchScreen },
    orders: { name: 'Orders', label: 'Orders', icon: 'receipt', component: OrdersScreen },
    profile: { name: 'Account', label: 'Account', icon: 'person', component: AccountScreen },
};
const DEFAULT_TABS = ['home', 'search', 'orders', 'profile'];

function MainTabs() {
    const insets = useSafeAreaInsets();
    const { primary, background, border, muted } = useBrand();
    const load = useHomeStore((s) => s.load);
    const tabsCfg = useHomeStore((s) => s.full.tabs);

    // one place loads the shop config for the whole app
    useEffect(() => { load(); }, [load]);

    let ids = (tabsCfg || []).filter((id) => TAB_DEFS[id]);
    if (ids.length < 2 || !ids.includes('home')) ids = DEFAULT_TABS;

    return (
        <Tab.Navigator
            initialRouteName="Home"
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
                            tabBarIcon: ({ focused, color }) => (
                                <View style={{ width: 58, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? alpha(primary, 0.14) : 'transparent' }}>
                                    <Ionicons name={focused ? d.icon : `${d.icon}-outline`} size={22} color={color} />
                                </View>
                            ),
                        }}
                    />
                );
            })}
        </Tab.Navigator>
    );
}

export default function AppNavigator() {
    const isHydrated = useAuthStore((s) => s.isHydrated);
    const user = useAuthStore((s) => s.user);
    const hydrate = useAuthStore((s) => s.hydrate);
    const hadUser = useRef(false);

    // "My orders" on the frozen screen: back to the tabs (no reload) and open Orders
    const goOrders = () => {
        useAppStatus.getState().clearFrozen();
        if (!navigationRef.isReady()) return;
        navigationRef.dispatch(StackActions.popToTop());
        navigationRef.dispatch(CommonActions.navigate({ name: 'Orders' }));
    };

    // 1) On app start: restore the saved session from SecureStore
    useEffect(() => {
        hydrate();
    }, [hydrate]);

    // 2) Signed-in user became signed-out (logout, or refresh token rejected): back to Login.
    //    Guests who tapped "Skip" never had a user, so they are not affected.
    useEffect(() => {
        if (!isHydrated) return;
        if (hadUser.current && !user && navigationRef.isReady()) {
            navigationRef.resetRoot({ index: 0, routes: [{ name: 'Login' }] });
        }
        hadUser.current = !!user;
    }, [isHydrated, user]);

    if (!isHydrated) {
        return (
            <View style={{ flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#FFFFFF" />
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <NavigationContainer ref={navigationRef}>
                <Stack.Navigator
                    screenOptions={{ headerShown: false }}
                    initialRouteName={user ? 'MainTabs' : 'Login'}
                >
                    {/* LoginScreen is untouched. Its Skip / success go to "MainTabs" */}
                    <Stack.Screen name="Login" component={LoginScreen} />
                    <Stack.Screen name="MainTabs" component={MainTabs} />

                    {/* full-screen pages (back arrow top left) */}
                    <Stack.Screen name="Item" component={ItemScreen} />
                    <Stack.Screen name="Cart" component={CartScreen} />
                    <Stack.Screen name="Offers" component={OffersScreen} />
                    <Stack.Screen name="Bestsellers" component={BestsellersScreen} />
                    <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} />
                    <Stack.Screen name="Favourites" component={FavouritesScreen} />
                    <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
                </Stack.Navigator>
            </NavigationContainer>
            <FrozenOverlay onOrders={goOrders} />
            <OfflineBanner />
            <ToastHost />
        </View>
    );
}