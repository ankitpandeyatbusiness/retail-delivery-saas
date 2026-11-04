import React, { useEffect, useRef } from 'react';
import { StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Animated, Dimensions, Easing, Platform } from 'react-native';
import Icon from '../components/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/useAuthStore';
import { useTheme, section } from '../theme';

import LoginScreen from '../screens/auth/LoginScreen';
import DashboardScreen from '../screens/home/DashboardScreen';
import AppLockScreen from '../screens/platform/AppLockScreen';
import MoreScreen from '../screens/platform/MoreScreen';
import TeamScreen from '../screens/platform/TeamScreen';
import InboxScreen from '../screens/platform/InboxScreen';
import SupportInboxScreen from '../screens/support/SupportInboxScreen';
import SupportDetailScreen from '../screens/support/SupportDetailScreen';
import SupportSettingsScreen from '../screens/support/SupportSettingsScreen';
import OwnerMessagesScreen from '../screens/platform/OwnerMessagesScreen';
import MaintenanceScreen from '../screens/platform/MaintenanceScreen';
import LiveTrackingScreen from '../screens/platform/LiveTrackingScreen';
import AlertSettingsScreen from '../screens/platform/AlertSettingsScreen';
import NotificationRulesScreen from '../screens/platform/NotificationRulesScreen';
import AuditLogScreen from '../screens/platform/AuditLogScreen';
import MyAccountScreen from '../screens/platform/MyAccountScreen';
import OrdersHomeScreen from '../screens/orders/OrdersHomeScreen';
import OrderDetailScreen from '../screens/orders/OrderDetailScreen';
import SalesReportScreen from '../screens/orders/SalesReportScreen';
import ComplaintDetailScreen from '../screens/operations/ComplaintDetailScreen';
import ShopOrdersScreen from '../screens/operations/ShopOrdersScreen';
import ShopRidersScreen from '../screens/operations/ShopRidersScreen';
import RiderDetailScreen from '../screens/operations/RiderDetailScreen';
import ShopComplaintsScreen from '../screens/operations/ShopComplaintsScreen';
import ShopMessagesScreen from '../screens/operations/ShopMessagesScreen';
import ShopAutopilotScreen from '../screens/operations/ShopAutopilotScreen';
import ShopsGrowthScreen from '../screens/platform/ShopsGrowthScreen';
import ShopReportScreen from '../screens/operations/ShopReportScreen';
import InsightsSettingsScreen from '../screens/platform/InsightsSettingsScreen';
import ShopActivityScreen from '../screens/operations/ShopActivityScreen';
import MoneyHomeScreen from '../screens/money/MoneyHomeScreen';
import MyRazorpayScreen from '../screens/money/MyRazorpayScreen';
import GstScreen from '../screens/money/GstScreen';
import MoneyRulesScreen from '../screens/money/MoneyRulesScreen';
import PlatformHealthScreen from '../screens/insights/PlatformHealthScreen';
import HealthScreen from '../screens/insights/HealthScreen';
import ReadinessScreen from '../screens/insights/ReadinessScreen';
import SystemScreen from '../screens/insights/SystemScreen';
import ExportsScreen from '../screens/insights/ExportsScreen';
import ProfitLossScreen from '../screens/insights/ProfitLossScreen';
import ReceivablesScreen from '../screens/insights/ReceivablesScreen';
import ExpensesScreen from '../screens/insights/ExpensesScreen';
import ExpenseFormScreen from '../screens/insights/ExpenseFormScreen';
import InvoicesScreen from '../screens/money/InvoicesScreen';
import InvoiceDetailScreen from '../screens/money/InvoiceDetailScreen';
import LedgerScreen from '../screens/money/LedgerScreen';
import SmsProfitScreen from '../screens/money/SmsProfitScreen';
import PlatformSmsScreen from '../screens/money/PlatformSmsScreen';
import PlatformBillingScreen from '../screens/money/PlatformBillingScreen';
import PlatformBusinessScreen from '../screens/money/PlatformBusinessScreen';
import GstRegisterScreen from '../screens/money/GstRegisterScreen';
import BrandsScreen from '../screens/operators/BrandsScreen';
import BrandDetailScreen from '../screens/operators/BrandDetailScreen';
import AgreementsScreen from '../screens/agreements/AgreementsScreen';
import AgreementDocScreen from '../screens/agreements/AgreementDocScreen';
import MoneyRecordScreen from '../screens/money/MoneyRecordScreen';
import ServicesOverviewScreen from '../screens/services/ServicesOverviewScreen';
import ServicesShopScreen from '../screens/services/ServicesShopScreen';
import ServicesInquiryScreen from '../screens/services/ServicesInquiryScreen';
import ServicesDefaultsScreen from '../screens/services/ServicesDefaultsScreen';
import ShopBillingScreen from '../screens/money/ShopBillingScreen';
import CustomInvoiceScreen from '../screens/money/CustomInvoiceScreen';
import ShopPaymentsScreen from '../screens/money/ShopPaymentsScreen';
import ShopBulkScreen from '../screens/services/ShopBulkScreen';
import ShopSmsScreen from '../screens/money/ShopSmsScreen';
import SmsProviderScreen from '../screens/money/SmsProviderScreen';
import ShopsListScreen from '../screens/shops/ShopsListScreen';
import ShopCreateScreen from '../screens/shops/ShopCreateScreen';
import ShopDetailScreen from '../screens/shops/ShopDetailScreen';
import ShopEditScreen from '../screens/shops/ShopEditScreen';
import ShopLiveScreen from '../screens/shops/ShopLiveScreen';
import ShopAccessScreen from '../screens/shops/ShopAccessScreen';
import ShopDevScreen from '../screens/shops/ShopDevScreen';
import ShopNotifyScreen from '../screens/shops/ShopNotifyScreen';
import ShopUsersScreen from '../screens/shops/ShopUsersScreen';
import ShopUserDetailScreen from '../screens/shops/ShopUserDetailScreen';
import ShopOwnersScreen from '../screens/shops/ShopOwnersScreen';
import ShopSettingsScreen from '../screens/settings/ShopSettingsScreen';
import SettingsBrandScreen from '../screens/settings/SettingsBrandScreen';
import SettingsTabsScreen from '../screens/settings/SettingsTabsScreen';
import SettingsHomeScreen from '../screens/settings/SettingsHomeScreen';
import SettingsFeaturesScreen from '../screens/settings/SettingsFeaturesScreen';
import SettingsMenuOffersScreen from '../screens/settings/SettingsMenuOffersScreen';
import SettingsOrdersScreen from '../screens/settings/SettingsOrdersScreen';
import SettingsDineInScreen from '../screens/settings/SettingsDineInScreen';
import SettingsPointsScreen from '../screens/settings/SettingsPointsScreen';
import SettingsHoursScreen from '../screens/settings/SettingsHoursScreen';
import SettingsRidersScreen from '../screens/settings/SettingsRidersScreen';
import SettingsLabelsScreen from '../screens/settings/SettingsLabelsScreen';
import SettingsAppScreen from '../screens/settings/SettingsAppScreen';
import ShopBrandingScreen from '../screens/shops/ShopBrandingScreen';
import ShopMenuScreen from '../screens/catalog/ShopMenuScreen';
import CategoryFormScreen from '../screens/catalog/CategoryFormScreen';
import ProductFormScreen from '../screens/catalog/ProductFormScreen';
import ProductImportScreen from '../screens/catalog/ProductImportScreen';
import CollectionsScreen from '../screens/catalog/CollectionsScreen';
import CollectionFormScreen from '../screens/catalog/CollectionFormScreen';
import BannersScreen from '../screens/catalog/BannersScreen';
import BannerFormScreen from '../screens/catalog/BannerFormScreen';
import CouponsScreen from '../screens/catalog/CouponsScreen';
import CouponFormScreen from '../screens/catalog/CouponFormScreen';


// One pace for every screen that opens and closes. On Android the old "slide_from_right" ignored the 180 ms we asked for (the duration setting is iOS only) and ran
// the system's slow medium time, with a straight-line pace, while the tabs ran 240 ms with an ease: so opening felt slower than closing and than the tabs.
// "slide_from_right" slides in and out for the same time both ways (Android's medium animation time, about 0.4 s; the quicker "ios_from_right" was about 0.2 s, which felt too fast).
// The tabs slide for the same time (TAB_SLIDE_MS) so everything moves at one pace. iOS keeps its own native push, which is already the same both ways.
const TAB_SLIDE_MS = 400;
const STACK_OPTIONS = { headerShown: false, animation: Platform.OS === 'android' ? 'slide_from_right' : 'default' };

const Root = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const Shops = createNativeStackNavigator();
const Home = createNativeStackNavigator();
const More = createNativeStackNavigator();
const Orders = createNativeStackNavigator();
const Money = createNativeStackNavigator();

// Every screen that opens inside a tab (a shop and all its pages, an order, an invoice, Platform health, SMS profit, Brands...) is registered in EVERY stack: each tab's
// and the one above the tabs. So any screen can be opened from wherever you are as a plain push on the stack you are in: the same slide, the same pace, and Back
// simply pops it and returns to exactly where you came from (no tab switch, no rebuilding, no remembered way back). Each tab's own first page stays its own.
const DETAIL = [
    ['PlatformHealth', PlatformHealthScreen],
    ['SmsProfit', SmsProfitScreen],
    ['SalesReport', SalesReportScreen],
    ['ShopsGrowth', ShopsGrowthScreen],
    ['LiveTracking', LiveTrackingScreen],
    ['MoneyRecord', MoneyRecordScreen],
    ['Brands', BrandsScreen],
    ['BrandDetail', BrandDetailScreen],
    ['ShopCreate', ShopCreateScreen],
    ['ShopDetail', ShopDetailScreen],
    ['ShopEdit', ShopEditScreen],
    ['ShopLive', ShopLiveScreen],
    ['ShopAccess', ShopAccessScreen],
    ['ShopDev', ShopDevScreen],
    ['ShopNotify', ShopNotifyScreen],
    ['ShopUsers', ShopUsersScreen],
    ['ShopUserDetail', ShopUserDetailScreen],
    ['ShopOwners', ShopOwnersScreen],
    ['ShopSettings', ShopSettingsScreen],
    ['SettingsBrand', SettingsBrandScreen],
    ['SettingsTabs', SettingsTabsScreen],
    ['SettingsHome', SettingsHomeScreen],
    ['SettingsFeatures', SettingsFeaturesScreen],
    ['SettingsMenuOffers', SettingsMenuOffersScreen],
    ['SettingsOrders', SettingsOrdersScreen],
    ['SettingsDineIn', SettingsDineInScreen],
    ['SettingsPoints', SettingsPointsScreen],
    ['SettingsHours', SettingsHoursScreen],
    ['SettingsRiders', SettingsRidersScreen],
    ['SettingsLabels', SettingsLabelsScreen],
    ['SettingsApp', SettingsAppScreen],
    ['ShopBranding', ShopBrandingScreen],
    ['ShopReport', ShopReportScreen],
    ['ShopAutopilot', ShopAutopilotScreen],
    ['ShopOrders', ShopOrdersScreen],
    ['OrderDetail', OrderDetailScreen],
    ['ShopRiders', ShopRidersScreen],
    ['RiderDetail', RiderDetailScreen],
    ['ShopComplaints', ShopComplaintsScreen],
    ['ComplaintDetail', ComplaintDetailScreen],
    ['ShopMessages', ShopMessagesScreen],
    ['ShopActivity', ShopActivityScreen],
    ['ShopBilling', ShopBillingScreen],
    ['CustomInvoice', CustomInvoiceScreen],
    ['ShopPayments', ShopPaymentsScreen],
    ['ShopBulk', ShopBulkScreen],
    ['ShopSms', ShopSmsScreen],
    ['SmsProvider', SmsProviderScreen],
    ['Invoices', InvoicesScreen],
    ['InvoiceDetail', InvoiceDetailScreen],
    ['Ledger', LedgerScreen],
    ['ShopMenu', ShopMenuScreen],
    ['CategoryForm', CategoryFormScreen],
    ['ProductForm', ProductFormScreen],
    ['ProductImport', ProductImportScreen],
    ['Collections', CollectionsScreen],
    ['CollectionForm', CollectionFormScreen],
    ['Banners', BannersScreen],
    ['BannerForm', BannerFormScreen],
    ['Coupons', CouponsScreen],
    ['CouponForm', CouponFormScreen],
    ['PlatformSms', PlatformSmsScreen],
    ['PlatformBilling', PlatformBillingScreen],
    ['PlatformBusiness', PlatformBusinessScreen],
    ['GstRegister', GstRegisterScreen],
    ['MyRazorpay', MyRazorpayScreen],
    ['Gst', GstScreen],
    ['MoneyRules', MoneyRulesScreen],
    ['Team', TeamScreen],
    ['AppLock', AppLockScreen],
    ['Maintenance', MaintenanceScreen],
    ['InsightsSettings', InsightsSettingsScreen],
    ['ServicesOverview', ServicesOverviewScreen],
    ['ServicesShop', ServicesShopScreen],
    ['ServicesInquiry', ServicesInquiryScreen],
    ['ServicesDefaults', ServicesDefaultsScreen],
    ['Agreements', AgreementsScreen],
    ['AgreementDoc', AgreementDocScreen],
    ['AlertSettings', AlertSettingsScreen],
    ['NotificationRules', NotificationRulesScreen],
    ['AuditLog', AuditLogScreen],
    ['MyAccount', MyAccountScreen],
];
const ROOT_OWN = new Set(["Admin","Inbox","Support","SupportDetail","SupportSettings","OwnerMessages","Health","ShopReadiness","System","Exports","ProfitLoss","Receivables","Expenses","ExpenseForm","Login"]);
const detailScreens = (S) => DETAIL.map(([name, component]) => <S.Screen key={name} name={name} component={component} />);

function HomeStack() {
    return (
        <Home.Navigator screenOptions={STACK_OPTIONS}>
            <Home.Screen name="HomeMain" component={DashboardScreen} />
            {detailScreens(Home)}
        </Home.Navigator>
    );
}

function ShopsStack() {
    return (
        <Shops.Navigator screenOptions={STACK_OPTIONS}>
            <Shops.Screen name="ShopsList" component={ShopsListScreen} />
            {detailScreens(Shops)}
        </Shops.Navigator>
    );
}

function OrdersStack() {
    return (
        <Orders.Navigator screenOptions={STACK_OPTIONS}>
            <Orders.Screen name="OrdersHome" component={OrdersHomeScreen} />
            {detailScreens(Orders)}
        </Orders.Navigator>
    );
}

function MoneyStack() {
    return (
        <Money.Navigator screenOptions={STACK_OPTIONS}>
            <Money.Screen name="MoneyHome" component={MoneyHomeScreen} />
            {detailScreens(Money)}
        </Money.Navigator>
    );
}

function MoreStack() {
    return (
        <More.Navigator screenOptions={STACK_OPTIONS}>
            <More.Screen name="MoreHome" component={MoreScreen} />
            {detailScreens(More)}
        </More.Navigator>
    );
}

// each tab has its own colour (from the palette sections), so the bar itself is colourful
const TABS = {
    HomeTab: { icon: 'home', section: 'shops' },
    ShopsTab: { icon: 'shops', section: 'shops' },
    OrdersTab: { icon: 'orders', section: 'orders' },
    MoneyTab: { icon: 'wallet', section: 'money' },
    MoreTab: { icon: 'menu', section: 'platform' },
};

// the pill grows out of the icon and the icon pops with a spring when its tab becomes active
function TabIcon({ focused, color, icon, soft }) {
    const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
    useEffect(() => {
        Animated.spring(v, { toValue: focused ? 1 : 0, friction: 5, tension: 160, useNativeDriver: true }).start();
    }, [focused, v]);
    return (
        <View style={{ width: 46, height: 30, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
                style={{
                    position: 'absolute', width: 46, height: 30, borderRadius: 15, backgroundColor: soft,
                    opacity: v, transform: [{ scaleX: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
                }}
            />
            <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }] }}>
                <Icon name={icon} size={24} color={color} filled={focused} />
            </Animated.View>
        </View>
    );
}

// Tabs slide the FULL width and a tab that is not open is parked completely off screen. No opacity on purpose: on
// Android a card's shadow ignores its parent's opacity, so a faded-out page still showed its shadows as a ghost.
const slideScenes = ({ current }) => {
    const W = Dimensions.get('window').width + 24;   // a little extra so no shadow reaches the edge
    return {
        sceneStyle: {
            transform: [{ translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-W, 0, W] }) }],
        },
    };
};

function AdminTabs() {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <Tabs.Navigator
            // pressing any tab (even from another tab) lands on that tab's first screen, not wherever it was left
            screenListeners={({ navigation, route }) => ({
                tabPress: () => {
                    const child = navigation.getState().routes.find((r) => r.key === route.key)?.state;
                    if (child?.key && child.index > 0) navigation.dispatch({ ...StackActions.popToTop(), target: child.key });
                },
            })}
            screenOptions={({ route }) => {
                const cfg = TABS[route.name];
                const color = section(t, cfg.section).color;
                return {
                    headerShown: false,
                    animation: 'shift',
                    sceneStyleInterpolator: slideScenes,
                    transitionSpec: { animation: 'timing', config: { duration: TAB_SLIDE_MS, easing: Easing.out(Easing.cubic) } },
                    tabBarActiveTintColor: color,
                    tabBarInactiveTintColor: t.muted,
                    tabBarStyle: {
                        backgroundColor: t.surface, borderTopWidth: 0, height: 62 + insets.bottom, paddingTop: 8,
                        borderTopLeftRadius: 24, borderTopRightRadius: 24, ...t.shadow, shadowOpacity: t.dark ? 0 : 0.18, elevation: 12,
                    },
                    tabBarLabelStyle: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
                    tabBarIcon: ({ focused, color: c }) => <TabIcon focused={focused} color={c} icon={cfg.icon} soft={section(t, cfg.section).soft} />,
                };
            }}
        >
            <Tabs.Screen name="HomeTab" component={HomeStack} options={{ title: 'Home' }} />
            <Tabs.Screen name="ShopsTab" component={ShopsStack} options={{ title: 'Shops' }} />
            <Tabs.Screen name="OrdersTab" component={OrdersStack} options={{ title: 'Orders' }} />
            <Tabs.Screen name="MoneyTab" component={MoneyStack} options={{ title: 'Money' }} />
            <Tabs.Screen name="MoreTab" component={MoreStack} options={{ title: 'More' }} />
        </Tabs.Navigator>
    );
}

export default function RootNavigator() {
    const token = useAuthStore((s) => s.token);
    return (
        // noAnim: set by Back (navigation/goTo.js) so the screen it brings back does not slide in over the tab under it
        <Root.Navigator screenOptions={({ route }) => (route.params?.noAnim ? { ...STACK_OPTIONS, animation: 'none' } : STACK_OPTIONS)}>
            {token ? (
                <>
                    <Root.Screen name="Admin" component={AdminTabs} />
                    {detailScreens(Root).filter((x) => !ROOT_OWN.has(x.key))}
                    <Root.Screen name="Inbox" component={InboxScreen} />
                    <Root.Screen name="Support" component={SupportInboxScreen} />
                    <Root.Screen name="SupportDetail" component={SupportDetailScreen} />
                    <Root.Screen name="SupportSettings" component={SupportSettingsScreen} />
                    <Root.Screen name="OwnerMessages" component={OwnerMessagesScreen} />
                    <Root.Screen name="Health" component={HealthScreen} />
                    <Root.Screen name="ShopReadiness" component={ReadinessScreen} />
                    <Root.Screen name="System" component={SystemScreen} />
                    <Root.Screen name="Exports" component={ExportsScreen} />
                    <Root.Screen name="ProfitLoss" component={ProfitLossScreen} />
                    <Root.Screen name="Receivables" component={ReceivablesScreen} />
                    <Root.Screen name="Expenses" component={ExpensesScreen} />
                    <Root.Screen name="ExpenseForm" component={ExpenseFormScreen} />
                </>
            ) : <Root.Screen name="Login" component={LoginScreen} options={{ animation: 'fade' }} />}
        </Root.Navigator>
    );
}
