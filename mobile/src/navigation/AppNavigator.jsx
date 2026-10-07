import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, CommonActions, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import ItemScreen from '../screens/ItemScreen';
import CartScreen from '../screens/CartScreen';
import SearchScreen from '../screens/SearchScreen';
import OrdersScreen from '../screens/OrdersScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import AccountScreen from '../screens/AccountScreen';
import { OffersScreen, BestsellersScreen, FavouritesScreen } from '../screens/ExtraPages';
import { useAuthStore } from '../store/useAuthStore';
import { useHomeStore } from '../store/useHomeStore';
import { useBrand } from '../components/ui/kit';
import { ToastHost } from '../components/ui/shop';
import { FrozenOverlay, OfflineBanner } from '../components/ui/status';
import { useAppStatus } from '../store/useAppStatus';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();


// config tab id -> screen. Unknown ids from the server are skipped.
const TAB_DEFS = {
    home: { name: 'Home', label: 'Home', icon: '🏠', component: HomeScreen },
    search: { name: 'Search', label: 'Search', icon: '🔍', component: SearchScreen },
    orders: { name: 'Orders', label: 'Orders', icon: '🧾', component: OrdersScreen },
    profile: { name: 'Account', label: 'Account', icon: '👤', component: AccountScreen },
};
const DEFAULT_TABS = ['home', 'search', 'orders', 'profile'];

function MainTabs() {
    const insets = useSafeAreaInsets();
    const { primary } = useBrand();
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
                tabBarActiveTintColor: primary,
                tabBarInactiveTintColor: '#888888',
                tabBarStyle: { height: 58 + insets.bottom, paddingBottom: insets.bottom + 4, paddingTop: 6, backgroundColor: '#FFFFFF' },
                tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
                            tabBarIcon: ({ focused }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.6 }}>{d.icon}</Text>,
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