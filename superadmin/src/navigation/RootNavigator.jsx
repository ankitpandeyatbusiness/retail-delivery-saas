import React, { useEffect, useRef } from 'react';
import { StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Animated, Dimensions, Easing } from 'react-native';
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
import SearchScreen from '../screens/insights/SearchScreen';
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
import OperatorsScreen from '../screens/operators/OperatorsScreen';
import OperatorEditScreen from '../screens/operators/OperatorEditScreen';
import AgreementsScreen from '../screens/agreements/AgreementsScreen';
import AgreementDocScreen from '../screens/agreements/AgreementDocScreen';
import SettlementScreen from '../screens/settlement/SettlementScreen';
import ServicesOverviewScreen from '../screens/services/ServicesOverviewScreen';
import ServicesShopScreen from '../screens/services/ServicesShopScreen';
import ServicesInquiryScreen from '../screens/services/ServicesInquiryScreen';
import ServicesDefaultsScreen from '../screens/services/ServicesDefaultsScreen';
import SettlementEntryScreen from '../screens/settlement/SettlementEntryScreen';
import SettlementSettingsScreen from '../screens/settlement/SettlementSettingsScreen';
import ShopBillingScreen from '../screens/money/ShopBillingScreen';
import CustomInvoiceScreen from '../screens/money/CustomInvoiceScreen';
import ShopPaymentsScreen from '../screens/money/ShopPaymentsScreen';
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


const Root = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const Shops = createNativeStackNavigator();
const More = createNativeStackNavigator();
const Orders = createNativeStackNavigator();
const Money = createNativeStackNavigator();

// All shop screens live in one stack inside the Shops tab, so the tab bar stays and back always works.
function ShopsStack() {
    return (
        <Shops.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 180 }}>
            <Shops.Screen name="ShopsList" component={ShopsListScreen} />
            <Shops.Screen name="ShopCreate" component={ShopCreateScreen} />
            <Shops.Screen name="ShopDetail" component={ShopDetailScreen} />
            <Shops.Screen name="ShopEdit" component={ShopEditScreen} />
            <Shops.Screen name="ShopLive" component={ShopLiveScreen} />
            <Shops.Screen name="ShopAccess" component={ShopAccessScreen} />
            <Shops.Screen name="ShopDev" component={ShopDevScreen} />
            <Shops.Screen name="ShopNotify" component={ShopNotifyScreen} />
            <Shops.Screen name="ShopUsers" component={ShopUsersScreen} />
            <Shops.Screen name="ShopUserDetail" component={ShopUserDetailScreen} />
            <Shops.Screen name="ShopOwners" component={ShopOwnersScreen} />
            <Shops.Screen name="ShopSettings" component={ShopSettingsScreen} />
            <Shops.Screen name="SettingsBrand" component={SettingsBrandScreen} />
            <Shops.Screen name="SettingsTabs" component={SettingsTabsScreen} />
            <Shops.Screen name="SettingsHome" component={SettingsHomeScreen} />
            <Shops.Screen name="SettingsFeatures" component={SettingsFeaturesScreen} />
            <Shops.Screen name="SettingsMenuOffers" component={SettingsMenuOffersScreen} />
            <Shops.Screen name="SettingsOrders" component={SettingsOrdersScreen} />
            <Shops.Screen name="SettingsDineIn" component={SettingsDineInScreen} />
            <Shops.Screen name="SettingsPoints" component={SettingsPointsScreen} />
            <Shops.Screen name="SettingsHours" component={SettingsHoursScreen} />
            <Shops.Screen name="SettingsRiders" component={SettingsRidersScreen} />
            <Shops.Screen name="SettingsLabels" component={SettingsLabelsScreen} />
            <Shops.Screen name="SettingsApp" component={SettingsAppScreen} />
            <Shops.Screen name="ShopBranding" component={ShopBrandingScreen} />
            <Shops.Screen name="ShopReport" component={ShopReportScreen} />
            <Shops.Screen name="ShopAutopilot" component={ShopAutopilotScreen} />
            <Shops.Screen name="ShopOrders" component={ShopOrdersScreen} />
            <Shops.Screen name="OrderDetail" component={OrderDetailScreen} />
            <Shops.Screen name="SalesReport" component={SalesReportScreen} />
            <Shops.Screen name="ShopRiders" component={ShopRidersScreen} />
            <Shops.Screen name="RiderDetail" component={RiderDetailScreen} />
            <Shops.Screen name="ShopComplaints" component={ShopComplaintsScreen} />
            <Shops.Screen name="ComplaintDetail" component={ComplaintDetailScreen} />
            <Shops.Screen name="ShopMessages" component={ShopMessagesScreen} />
            <Shops.Screen name="ShopActivity" component={ShopActivityScreen} />
            <Shops.Screen name="ShopBilling" component={ShopBillingScreen} />
            <Shops.Screen name="CustomInvoice" component={CustomInvoiceScreen} />
            <Shops.Screen name="ShopPayments" component={ShopPaymentsScreen} />
            <Shops.Screen name="ShopSms" component={ShopSmsScreen} />
            <Shops.Screen name="SmsProvider" component={SmsProviderScreen} />
            <Shops.Screen name="Invoices" component={InvoicesScreen} />
            <Shops.Screen name="InvoiceDetail" component={InvoiceDetailScreen} />
            <Shops.Screen name="Ledger" component={LedgerScreen} />
            <Shops.Screen name="ShopMenu" component={ShopMenuScreen} />
            <Shops.Screen name="CategoryForm" component={CategoryFormScreen} />
            <Shops.Screen name="ProductForm" component={ProductFormScreen} />
            <Shops.Screen name="ProductImport" component={ProductImportScreen} />
            <Shops.Screen name="Collections" component={CollectionsScreen} />
            <Shops.Screen name="CollectionForm" component={CollectionFormScreen} />
            <Shops.Screen name="Banners" component={BannersScreen} />
            <Shops.Screen name="BannerForm" component={BannerFormScreen} />
            <Shops.Screen name="Coupons" component={CouponsScreen} />
            <Shops.Screen name="CouponForm" component={CouponFormScreen} />
        </Shops.Navigator>
    );
}

function OrdersStack() {
    return (
        <Orders.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 180 }}>
            <Orders.Screen name="OrdersHome" component={OrdersHomeScreen} />
            <Orders.Screen name="OrderDetail" component={OrderDetailScreen} />
            <Orders.Screen name="SalesReport" component={SalesReportScreen} />
            <Orders.Screen name="ComplaintDetail" component={ComplaintDetailScreen} />
        </Orders.Navigator>
    );
}

function MoneyStack() {
    return (
        <Money.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 180 }}>
            <Money.Screen name="MoneyHome" component={MoneyHomeScreen} />
            <Money.Screen name="Invoices" component={InvoicesScreen} />
            <Money.Screen name="InvoiceDetail" component={InvoiceDetailScreen} />
            <Money.Screen name="Ledger" component={LedgerScreen} />
            <Money.Screen name="SmsProfit" component={SmsProfitScreen} />
            <Money.Screen name="PlatformSms" component={PlatformSmsScreen} />
            <Money.Screen name="PlatformBilling" component={PlatformBillingScreen} />
            <Money.Screen name="PlatformBusiness" component={PlatformBusinessScreen} />
            <Money.Screen name="GstRegister" component={GstRegisterScreen} />
            <Money.Screen name="MyRazorpay" component={MyRazorpayScreen} />
            <Money.Screen name="Gst" component={GstScreen} />
            <Money.Screen name="MoneyRules" component={MoneyRulesScreen} />
        </Money.Navigator>
    );
}

function MoreStack() {
    return (
        <More.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 180 }}>
            <More.Screen name="MoreHome" component={MoreScreen} />
            <More.Screen name="Team" component={TeamScreen} />
            <More.Screen name="AppLock" component={AppLockScreen} />
            <More.Screen name="Maintenance" component={MaintenanceScreen} />
            <More.Screen name="LiveTracking" component={LiveTrackingScreen} />
            <More.Screen name="InsightsSettings" component={InsightsSettingsScreen} />
            <More.Screen name="GstRegister" component={GstRegisterScreen} />
            <More.Screen name="Settlement" component={SettlementScreen} />
            <More.Screen name="ServicesOverview" component={ServicesOverviewScreen} />
            <More.Screen name="ServicesShop" component={ServicesShopScreen} />
            <More.Screen name="ServicesInquiry" component={ServicesInquiryScreen} />
            <More.Screen name="ServicesDefaults" component={ServicesDefaultsScreen} />
            <More.Screen name="Agreements" component={AgreementsScreen} />
            <More.Screen name="Operators" component={OperatorsScreen} />
            <More.Screen name="OperatorEdit" component={OperatorEditScreen} />
            <More.Screen name="AgreementDoc" component={AgreementDocScreen} />
            <More.Screen name="SettlementEntry" component={SettlementEntryScreen} />
            <More.Screen name="SettlementSettings" component={SettlementSettingsScreen} />
            <More.Screen name="ShopsGrowth" component={ShopsGrowthScreen} />
            <More.Screen name="AlertSettings" component={AlertSettingsScreen} />
            <More.Screen name="NotificationRules" component={NotificationRulesScreen} />
            <More.Screen name="AuditLog" component={AuditLogScreen} />
            <More.Screen name="MyAccount" component={MyAccountScreen} />
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
                    transitionSpec: { animation: 'timing', config: { duration: 240, easing: Easing.out(Easing.cubic) } },
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
            <Tabs.Screen name="HomeTab" component={DashboardScreen} options={{ title: 'Home' }} />
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
        <Root.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 180 }}>
            {token ? (
                <>
                    <Root.Screen name="Admin" component={AdminTabs} />
                    <Root.Screen name="Inbox" component={InboxScreen} />
                    <Root.Screen name="Support" component={SupportInboxScreen} />
                    <Root.Screen name="SupportDetail" component={SupportDetailScreen} />
                    <Root.Screen name="SupportSettings" component={SupportSettingsScreen} />
                    <Root.Screen name="OwnerMessages" component={OwnerMessagesScreen} />
                    <Root.Screen name="Search" component={SearchScreen} />
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
