import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, Keyboard, StyleSheet, Platform, Dimensions, BackHandler } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef, CommonActions, StackActions, useNavigation, useFocusEffect } from '@react-navigation/native';
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
import LiveOrderHost from '../components/customers/LiveOrderHost';
import ActiveOrderBar from '../components/customers/ActiveOrderBar';
import ReviewPrompts from '../components/customers/ReviewPrompts';
import OrderPlacedScreen from '../screens/customers/OrderPlacedScreen';
import RiderTabs from './RiderNavigator';
import StaffTabs from './StaffNavigator';
import OwnerStaffScreen from '../screens/owners/OwnerStaffScreen';
import { OwnerCooksScreen, OwnerWaitersScreen } from '../screens/owners/OwnerStaffGroupScreen';
import OwnerStaffPersonScreen from '../screens/owners/OwnerStaffPersonScreen';
import OwnerAppLockScreen from '../screens/owners/OwnerAppLockScreen';
import RiderTripScreen from '../screens/riders/RiderTripScreen';
import StaffLeaveScreen from '../screens/staff/StaffLeaveScreen';
import RiderDutyScreen from '../screens/riders/RiderDutyScreen';
import RiderPointsScreen from '../screens/riders/RiderPointsScreen';
import MyPointsScreen from '../screens/customers/MyPointsScreen';
import ServicesScreen from '../screens/customers/ServicesScreen';
import ServiceFormScreen from '../screens/customers/ServiceFormScreen';
import MyInquiriesScreen from '../screens/customers/MyInquiriesScreen';
import TableBillScreen from '../screens/customers/TableBillScreen';
import TableBillStrip from '../components/customers/TableBillStrip';
import BookingStrip from '../components/customers/BookingStrip';
import BottomDock from '../components/customers/BottomDock';
import TableLinkHost from '../components/customers/TableLinkHost';
import OwedReminder from '../components/customers/OwedReminder';
import TableFeedbackHost from '../components/customers/TableFeedbackHost';
import OwedClaimHost from '../components/owners/OwedClaimHost';
import PickupChangeHost from '../components/owners/PickupChangeHost';
import CustomerAskHost from '../components/owners/CustomerAskHost';
import PickupCollectHost from '../components/customers/PickupCollectHost';
import JoinRequestHost from '../components/customers/JoinRequestHost';
import useTablePresence from '../hooks/customers/useTablePresence';
function PresenceBeat() { useTablePresence(); return null; }   // the guest's phone tells the shop it is here (see the hook)
import ScanTableScreen from '../screens/customers/ScanTableScreen';
import OwnerRewardsScreen from '../screens/owners/OwnerRewardsScreen';
import OwnerDineInScreen from '../screens/owners/OwnerDineInScreen';
import OwnerHeroScreen from '../screens/owners/OwnerHeroScreen';
import OwnerDineInReportScreen from '../screens/owners/OwnerDineInReportScreen';
import ReferFriendScreen from '../screens/customers/ReferFriendScreen';
import OwnerMoneyRulesScreen from '../screens/owners/OwnerMoneyRulesScreen';
import OwnerTabs from './OwnerNavigator';
import ShopHubScreen from '../screens/owners/ShopHubScreen';
import SoundboxScreen from '../screens/owners/SoundboxScreen';
import AlertSettingsScreen from '../screens/common/AlertSettingsScreen';
import { OwnerMoneyPage } from '../screens/owners/OwnerMoneyScreen';
import AlertSliderHost from '../components/common/AlertSliderHost';
import { OwnerStubPage } from '../screens/owners/OwnerStubScreens';
import OwnerOrderScreen from '../screens/owners/OwnerOrderScreen';
import OwnerRiderScreen from '../screens/owners/OwnerRiderScreen';
import OwnerRiderMapScreen from '../screens/owners/OwnerRiderMapScreen';
import OwnerPerformanceScreen from '../screens/owners/OwnerPerformanceScreen';
import OwnerRiderRulesScreen from '../screens/owners/OwnerRiderRulesScreen';
import OwnerPaymentsScreen from '../screens/owners/OwnerPaymentsScreen';
import OwnerSmsScreen from '../screens/owners/OwnerSmsScreen';
import OwnerRentScreen from '../screens/owners/OwnerRentScreen';
import OwnerCustomersScreen from '../screens/owners/OwnerCustomersScreen';
import OwnerCustomerScreen from '../screens/owners/OwnerCustomerScreen';
import OwnerComplaintsScreen from '../screens/owners/OwnerComplaintsScreen';
import OwnerComplaintScreen from '../screens/owners/OwnerComplaintScreen';
import OwnerReviewsScreen from '../screens/owners/OwnerReviewsScreen';
import OwnerMessagesScreen from '../screens/owners/OwnerMessagesScreen';
import OwnerCouponsScreen from '../screens/owners/OwnerCouponsScreen';
import OwnerCouponScreen from '../screens/owners/OwnerCouponScreen';
import OwnerBookingsScreen from '../screens/owners/OwnerBookingsScreen';
import OwnerBookingDenyScreen from '../screens/owners/OwnerBookingDenyScreen';
import BookingScanScreen from '../screens/common/BookingScanScreen';
import OwnerBookingSettingsScreen from '../screens/owners/OwnerBookingSettingsScreen';
import BookTableScreen from '../screens/customers/BookTableScreen';
import MyBookingsScreen from '../screens/customers/MyBookingsScreen';
import OwnerInquiriesScreen from '../screens/owners/OwnerInquiriesScreen';
import OwnerInquiryScreen from '../screens/owners/OwnerInquiryScreen';
import InquiryScreen from '../screens/customers/InquiryScreen';
import OwnerServicesScreen from '../screens/owners/OwnerServicesScreen';
import OwnerServiceScreen from '../screens/owners/OwnerServiceScreen';
import OwnerBannersScreen from '../screens/owners/OwnerBannersScreen';
import OwnerBannerScreen from '../screens/owners/OwnerBannerScreen';
import OwnerHoursScreen from '../screens/owners/OwnerHoursScreen';
import OwnerDeliveryScreen from '../screens/owners/OwnerDeliveryScreen';
import OwnerShopSettingsScreen from '../screens/owners/OwnerShopSettingsScreen';
import OwnerNotificationsScreen from '../screens/owners/OwnerNotificationsScreen';
import OwnerActivityScreen from '../screens/owners/OwnerActivityScreen';
import OwnerClosingScreen from '../screens/owners/OwnerClosingScreen';
import OwnerItemScreen from '../screens/owners/OwnerItemScreen';
import OwnerCategoriesScreen from '../screens/owners/OwnerCategoriesScreen';
import OwnerCategoryScreen from '../screens/owners/OwnerCategoryScreen';
import OwnerCollectionsScreen from '../screens/owners/OwnerCollectionsScreen';
import OwnerCollectionScreen from '../screens/owners/OwnerCollectionScreen';
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
import { ToastHost, showToast, useClosedStyle } from '../components/customers/shop';
import { FrozenOverlay, OfflineBanner } from '../components/common/status';
import { useAppStatus } from '../store/common/useAppStatus';
import { useViewMode } from '../store/owners/useViewMode';
import OwnerViewPill from '../components/owners/OwnerViewPill';
import NewOrderPopup from '../components/owners/NewOrderPopup';
import KitchenProblemPopup from '../components/owners/KitchenProblemPopup';
import LegalGate from '../components/common/LegalGate';
import { LegalDocScreen, LegalListScreen } from '../screens/common/LegalScreens';
import OwnerBusinessScreen from '../screens/owners/OwnerBusinessScreen';
import OwnerAutopilotScreen from '../screens/owners/OwnerAutopilotScreen';
import OwnerSupportScreen from '../screens/owners/OwnerSupportScreen';
import OwnerSupportNewScreen from '../screens/owners/OwnerSupportNewScreen';
import OwnerSupportTicketScreen from '../screens/owners/OwnerSupportTicketScreen';
import OwnerProfileScreen from '../screens/owners/OwnerProfileScreen';
import OwnerPopularScreen from '../screens/owners/OwnerPopularScreen';
import OwnerPayScreen from '../screens/owners/OwnerPayScreen';
import OwnerTransactionsScreen from '../screens/owners/OwnerTransactionsScreen';
import { OwnerMoneyHub, OwnerShopFrontHub, OwnerBillsHub, OwnerDeliveryHub, OwnerReportsHub, OwnerInboxHub } from '../screens/owners/OwnerHubs';
import OwnerMonthScreen from '../screens/owners/OwnerMonthScreen';
import { FloatingTabBar, slideScenes, TabGlyph, gate, holdGate, releaseGate, bindGateNavigation } from './tabKit';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();
bindNavigation(navigationRef);
bindGateNavigation(navigationRef);


// config tab id -> screen. Unknown ids from the server are skipped.
const TAB_DEFS = {
    home: { name: 'Home', label: 'Home', icon: 'home', component: HomeScreen },
    search: { name: 'Search', label: 'Search', icon: 'search', component: SearchScreen },
    orders: { name: 'Orders', label: 'Orders', icon: 'receipt', component: OrdersScreen },
    cart: { name: 'CartTab', label: 'Cart', icon: 'cart', component: CartScreen },
    profile: { name: 'Account', label: 'Account', icon: 'person', component: AccountScreen },
};
const DEFAULT_TABS = ['home', 'search', 'orders', 'profile'];

function MainTabs() {
    const insets = useSafeAreaInsets();
    const { primary, background, border, muted } = useBrand();
    const load = useHomeStore((s) => s.load);
    const tabsCfg = useHomeStore((s) => s.full.tabs);
    const count = useCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    const floating = useThemeStore((s) => s.theme.tabBarStyle) === 'floating';
    const tabMotion = useMotion();
    const closedStyle = useClosedStyle();   // the shop is closed: the tabs turn grey with the screens
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
                            tabBarItemStyle: d.name === 'Account' ? undefined : closedStyle,   // the shop is closed: these tabs turn grey, Account stays in colour
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

// One app, four panels, chosen by the phone number's role: a rider gets the delivery screen, the shop owner
// ("admin") gets the owner panel, a cook or waiter ("kitchen" / "waiter") gets the staff screens, everybody else gets the customer tabs.
function Landing() {
    const role = useAuthStore((s) => s.user?.role);
    if (role === 'rider') return <RiderTabs />;
    if (role === 'admin') return <OwnerTabs />;
    if (role === 'kitchen' || role === 'waiter') return <StaffTabs />;
    return <MainTabs />;
}

// The owner looking at the customer app. It is a page on top of the owner panel, so it slides in from the right and slides
// out again like every other page. The Android Back button on its Home tab closes it (instead of "press back again to exit").
function CustomerPreview() {
    const nav = useNavigation();
    useEffect(() => {
        useViewMode.getState().setCustomerView(true);
        return () => useViewMode.getState().setCustomerView(false);
    }, []);
    useFocusEffect(React.useCallback(() => {
        if (Platform.OS !== 'android') return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            if (navigationRef.getCurrentRoute()?.name !== 'Home') return false;   // other tabs: the tabs go back to Home first
            nav.goBack();
            return true;
        });
        return () => sub.remove();
    }, [nav]));
    return <MainTabs />;
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
            const here = navigationRef.getCurrentRoute()?.name;
            if (here !== 'Home' && here !== 'HomeTab' && here !== 'RiderHomeTab') return false;   // not a Home tab: normal behaviour
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
    const [routeName, setRouteName] = useState(null);   // the screen in front (the live-delivery bar hides on some)

    // "My orders" on the frozen screen: back to the tabs (no reload) and open Orders
    const goOrders = () => {
        useAppStatus.getState().clearFrozen();
        if (!navigationRef.isReady()) return;
        // popToTop is refused (an error) when the stack has only its first screen
        if ((navigationRef.getRootState()?.routes?.length || 0) > 1) navigationRef.dispatch(StackActions.popToTop());
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
            <NavigationContainer ref={navigationRef} onReady={() => { navigationReady(); setRouteName(navigationRef.getCurrentRoute()?.name); }} onStateChange={() => setRouteName(navigationRef.getCurrentRoute()?.name)} theme={navTheme}>
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
                    <Stack.Screen name="LegalList" component={LegalListScreen} />
                    {/* RiderTrip: a rider's delivery, one step at a time */}
                    <Stack.Screen name="RiderTrip" component={RiderTripScreen} />
                    <Stack.Screen name="RiderDuty" component={RiderDutyScreen} />
                    <Stack.Screen name="StaffLeave" component={StaffLeaveScreen} />
                    <Stack.Screen name="RiderPoints" component={RiderPointsScreen} />
                    <Stack.Screen name="MyPoints" component={MyPointsScreen} />
                    <Stack.Screen name="BookTable" component={BookTableScreen} />
                    <Stack.Screen name="MyBookings" component={MyBookingsScreen} />
                    <Stack.Screen name="Services" component={ServicesScreen} />
                    <Stack.Screen name="ServiceForm" component={ServiceFormScreen} />
                    <Stack.Screen name="Inquiry" component={InquiryScreen} />
                    <Stack.Screen name="MyInquiries" component={MyInquiriesScreen} />
                    <Stack.Screen name="TableBill" component={TableBillScreen} />
                    <Stack.Screen name="ReferFriend" component={ReferFriendScreen} />
                    <Stack.Screen name="ScanTable" component={ScanTableScreen} />
                    <Stack.Screen name="LegalDoc" component={LegalDocScreen} />

                    {/* owner pages (role "admin"); the owner's tabs are MainTabs -> Landing -> OwnerTabs */}
                    <Stack.Screen name="ShopHub" component={ShopHubScreen} />
                    <Stack.Screen name="Soundbox" component={SoundboxScreen} />
                    <Stack.Screen name="AlertSettings" component={AlertSettingsScreen} />
                    <Stack.Screen name="OwnerMoney" component={OwnerMoneyPage} />
                    <Stack.Screen name="OwnerStub" component={OwnerStubPage} />
                    <Stack.Screen name="OwnerOrder" component={OwnerOrderScreen} />
                    <Stack.Screen name="OwnerRider" component={OwnerRiderScreen} />
                    <Stack.Screen name="OwnerRiderMap" component={OwnerRiderMapScreen} />
                    <Stack.Screen name="OwnerPerformance" component={OwnerPerformanceScreen} />
                    <Stack.Screen name="OwnerRiderRules" component={OwnerRiderRulesScreen} />
                    <Stack.Screen name="OwnerStaff" component={OwnerStaffScreen} />
                    <Stack.Screen name="OwnerCooks" component={OwnerCooksScreen} />
                    <Stack.Screen name="OwnerWaiters" component={OwnerWaitersScreen} />
                    <Stack.Screen name="OwnerStaffPerson" component={OwnerStaffPersonScreen} />
                    <Stack.Screen name="OwnerAppLock" component={OwnerAppLockScreen} />
                    <Stack.Screen name="OwnerPayments" component={OwnerPaymentsScreen} />
                    <Stack.Screen name="OwnerSms" component={OwnerSmsScreen} />
                    <Stack.Screen name="OwnerRent" component={OwnerRentScreen} />
                    <Stack.Screen name="OwnerCustomers" component={OwnerCustomersScreen} />
                    <Stack.Screen name="OwnerCustomer" component={OwnerCustomerScreen} />
                    <Stack.Screen name="OwnerComplaints" component={OwnerComplaintsScreen} />
                    <Stack.Screen name="OwnerComplaint" component={OwnerComplaintScreen} />
                    <Stack.Screen name="OwnerReviews" component={OwnerReviewsScreen} />
                    <Stack.Screen name="OwnerMessages" component={OwnerMessagesScreen} />
                    <Stack.Screen name="OwnerCoupons" component={OwnerCouponsScreen} />
                    <Stack.Screen name="OwnerCoupon" component={OwnerCouponScreen} />
                    <Stack.Screen name="OwnerBookings" component={OwnerBookingsScreen} />
                    <Stack.Screen name="OwnerBookingDeny" component={OwnerBookingDenyScreen} />
                    <Stack.Screen name="BookingScan" component={BookingScanScreen} />
                    <Stack.Screen name="OwnerBookingSettings" component={OwnerBookingSettingsScreen} />
                    <Stack.Screen name="OwnerInquiries" component={OwnerInquiriesScreen} />
                    <Stack.Screen name="OwnerInquiry" component={OwnerInquiryScreen} />
                    <Stack.Screen name="OwnerServices" component={OwnerServicesScreen} />
                    <Stack.Screen name="OwnerService" component={OwnerServiceScreen} />
                    <Stack.Screen name="OwnerBanners" component={OwnerBannersScreen} />
                    <Stack.Screen name="OwnerBanner" component={OwnerBannerScreen} />
                    <Stack.Screen name="OwnerHours" component={OwnerHoursScreen} />
                    <Stack.Screen name="OwnerDelivery" component={OwnerDeliveryScreen} />
                    <Stack.Screen name="OwnerShopSettings" component={OwnerShopSettingsScreen} />
                    <Stack.Screen name="OwnerNotifications" component={OwnerNotificationsScreen} />
                    <Stack.Screen name="OwnerActivity" component={OwnerActivityScreen} />
                    <Stack.Screen name="OwnerClosing" component={OwnerClosingScreen} />
                    <Stack.Screen name="CustomerPreview" component={CustomerPreview} />
                    <Stack.Screen name="OwnerBusiness" component={OwnerBusinessScreen} />
                    <Stack.Screen name="OwnerAutopilot" component={OwnerAutopilotScreen} />
                    <Stack.Screen name="OwnerRewards" component={OwnerRewardsScreen} />
                    <Stack.Screen name="OwnerDineIn" component={OwnerDineInScreen} />
                    <Stack.Screen name="OwnerHero" component={OwnerHeroScreen} />
                    <Stack.Screen name="OwnerDineInReport" component={OwnerDineInReportScreen} />
                    <Stack.Screen name="OwnerMoneyRules" component={OwnerMoneyRulesScreen} />
                    <Stack.Screen name="OwnerSupport" component={OwnerSupportScreen} />
                    <Stack.Screen name="OwnerSupportNew" component={OwnerSupportNewScreen} />
                    <Stack.Screen name="OwnerSupportTicket" component={OwnerSupportTicketScreen} />
                    <Stack.Screen name="OwnerProfile" component={OwnerProfileScreen} />
                    <Stack.Screen name="OwnerPopular" component={OwnerPopularScreen} />
                    <Stack.Screen name="OwnerPay" component={OwnerPayScreen} />
                    <Stack.Screen name="OwnerTransactions" component={OwnerTransactionsScreen} />
                    <Stack.Screen name="OwnerMonth" component={OwnerMonthScreen} />
                    <Stack.Screen name="OwnerItem" component={OwnerItemScreen} />
                    <Stack.Screen name="OwnerCategories" component={OwnerCategoriesScreen} />
                    <Stack.Screen name="OwnerCategory" component={OwnerCategoryScreen} />
                    <Stack.Screen name="OwnerCollections" component={OwnerCollectionsScreen} />
                    <Stack.Screen name="OwnerMoneyHub" component={OwnerMoneyHub} />
                    <Stack.Screen name="OwnerShopFrontHub" component={OwnerShopFrontHub} />
                    <Stack.Screen name="OwnerBillsHub" component={OwnerBillsHub} />
                    <Stack.Screen name="OwnerDeliveryHub" component={OwnerDeliveryHub} />
                    <Stack.Screen name="OwnerReportsHub" component={OwnerReportsHub} />
                    <Stack.Screen name="OwnerInboxHub" component={OwnerInboxHub} />
                    <Stack.Screen name="OwnerCollection" component={OwnerCollectionScreen} />
                </Stack.Navigator>
            </NavigationContainer>
            <OwnerViewPill onBack={() => { if (navigationRef.isReady() && (navigationRef.getRootState()?.routes?.length || 0) > 1) navigationRef.dispatch(StackActions.popToTop()); }} />
            <LiveOrderHost routeName={routeName} onOpenOrder={(id) => { if (navigationRef.isReady()) navigationRef.navigate('OrderDetail', { id }); }} />
            <ActiveOrderBar routeName={routeName} onOpen={(id) => { if (navigationRef.isReady()) navigationRef.navigate('OrderDetail', { id }); }} onOpenAll={goOrders} />
            <TableLinkHost onDone={() => { if (navigationRef.isReady()) navigationRef.navigate('MainTabs'); }} />
            <TableBillStrip routeName={routeName} onOpen={() => { if (navigationRef.isReady()) navigationRef.navigate('TableBill'); }} onOpenCart={() => { if (navigationRef.isReady()) navigationRef.navigate('Cart'); }} />
            <BookingStrip routeName={routeName} onOpen={() => { if (navigationRef.isReady()) navigationRef.navigate('MyBookings'); }} />
            <BottomDock navRef={navigationRef} />
            <ReviewPrompts />
            <OwedReminder />
            <PickupCollectHost />
            <JoinRequestHost />
            <PresenceBeat />
            <TableFeedbackHost navRef={navigationRef} />
            <NewOrderPopup navRef={navigationRef} />
            <KitchenProblemPopup />
            <AlertSliderHost navRef={navigationRef} />
            <OwedClaimHost />
            <PickupChangeHost />
            <CustomerAskHost />
            <LegalGate />
            <FrozenOverlay onOrders={goOrders} />
            <OfflineBanner />
            <ToastHost />
        </View>
    );
}