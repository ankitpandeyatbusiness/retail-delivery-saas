import React from 'react';
import { StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Dimensions, Easing, Platform } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { useTheme } from '../theme';
import FloatingTabBar, { gate, holdGate, releaseGate } from './FloatingTabBar';

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
import LegalPagesScreen from '../screens/legalPages/LegalPagesScreen';
import LegalPageEditScreen from '../screens/legalPages/LegalPageEditScreen';
import MaintenanceScreen from '../screens/platform/MaintenanceScreen';
import DemoLoginScreen from '../screens/platform/DemoLoginScreen';
import DemoLeadsScreen from '../screens/platform/DemoLeadsScreen';
import QrCodesScreen from '../screens/platform/QrCodesScreen';
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
import ExpensesScreen from '../screens/insights/ExpensesScreen';
import ExpenseFormScreen from '../screens/insights/ExpenseFormScreen';
import LedgerScreen from '../screens/money/LedgerScreen';
import SmsProfitScreen from '../screens/money/SmsProfitScreen';
import PlatformSmsScreen from '../screens/money/PlatformSmsScreen';
import PlatformBusinessScreen from '../screens/money/PlatformBusinessScreen';
import GstRegisterScreen from '../screens/money/GstRegisterScreen';
import BrandsScreen from '../screens/operators/BrandsScreen';
import BrandDetailScreen from '../screens/operators/BrandDetailScreen';
import MoneyRecordScreen from '../screens/money/MoneyRecordScreen';
import ServicesOverviewScreen from '../screens/services/ServicesOverviewScreen';
import ServicesShopScreen from '../screens/services/ServicesShopScreen';
import ServicesInquiryScreen from '../screens/services/ServicesInquiryScreen';
import ServicesDefaultsScreen from '../screens/services/ServicesDefaultsScreen';
import ShopPaymentsScreen from '../screens/money/ShopPaymentsScreen';
import ShopBulkScreen from '../screens/services/ShopBulkScreen';
import ShopSmsScreen from '../screens/money/ShopSmsScreen';
import SmsProviderScreen from '../screens/money/SmsProviderScreen';
import ShopsListScreen from '../screens/shops/ShopsListScreen';
import ShopCreateScreen from '../screens/shops/ShopCreateScreen';
import ShopDetailScreen from '../screens/shops/ShopDetailScreen';
import ShopSetupScreen from '../screens/shops/ShopSetupScreen';
import ShopFolderScreen from '../screens/shops/ShopFolderScreen';
import ShopCloseScreen from '../screens/shops/ShopCloseScreen';
import RefundsScreen from '../screens/orders/RefundsScreen';
import MoneyAttentionScreen from '../screens/money/MoneyAttentionScreen';
import SmsSetupScreen from '../screens/platform/SmsSetupScreen';
import ServerSetupScreen from '../screens/platform/ServerSetupScreen';
import ExportBuildScreen from '../screens/insights/ExportBuildScreen';
import MaintenancePlanScreen from '../screens/platform/MaintenancePlanScreen';
import ShopsToolsScreen from '../screens/shops/ShopsToolsScreen';
import MonthCloseScreen from '../screens/money/MonthCloseScreen';
import MoneySettingsScreen from '../screens/money/MoneySettingsScreen';
import SmsBalanceScreen from '../screens/money/SmsBalanceScreen';
import CustomersScreen from '../screens/orders/CustomersScreen';
import ShopQualityScreen from '../screens/orders/ShopQualityScreen';
import OrderLimitsScreen from '../screens/orders/OrderLimitsScreen';
import RepeatCancellersScreen from '../screens/orders/RepeatCancellersScreen';
import ShopEditScreen from '../screens/shops/ShopEditScreen';
import ShopLiveScreen from '../screens/shops/ShopLiveScreen';
import ShopAccessScreen from '../screens/shops/ShopAccessScreen';
import ShopPlanScreen from '../screens/shops/ShopPlanScreen';
import ShopRefundScreen from '../screens/shops/ShopRefundScreen';
import PlanDefaultsScreen from '../screens/platform/PlanDefaultsScreen';
import PlanCouponsScreen from '../screens/platform/PlanCouponsScreen';
import PlanOverviewScreen from '../screens/platform/PlanOverviewScreen';
import PlanMigrationScreen from '../screens/platform/PlanMigrationScreen';
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
import SettingsAppScreen from '../screens/settings/SettingsAppScreen';
import ShopBrandingScreen from '../screens/shops/ShopBrandingScreen';
import LoginBackgroundsScreen from '../screens/platform/LoginBackgroundsScreen';
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
    ['ShopClose', ShopCloseScreen],
    ['ShopFolder', ShopFolderScreen],
    ['ShopSetup', ShopSetupScreen],
    ['Refunds', RefundsScreen],
    ['MoneyAttention', MoneyAttentionScreen],
    ['SmsSetup', SmsSetupScreen],
    ['ServerSetup', ServerSetupScreen],
    ['ExportBuild', ExportBuildScreen],
    ['MaintenancePlan', MaintenancePlanScreen],
    ['ShopsTools', ShopsToolsScreen],
    ['MonthClose', MonthCloseScreen],
    ['MoneySettings', MoneySettingsScreen],
    ['SmsBalance', SmsBalanceScreen],
    ['Customers', CustomersScreen],
    ['ShopQuality', ShopQualityScreen],
    ['OrderLimits', OrderLimitsScreen],
    ['RepeatCancellers', RepeatCancellersScreen],
    ['ShopLive', ShopLiveScreen],
    ['ShopAccess', ShopAccessScreen],
    ['ShopPlan', ShopPlanScreen],
    ['ShopRefund', ShopRefundScreen],
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
    ['ShopPayments', ShopPaymentsScreen],
    ['ShopBulk', ShopBulkScreen],
    ['ShopSms', ShopSmsScreen],
    ['SmsProvider', SmsProviderScreen],
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
    ['PlatformBusiness', PlatformBusinessScreen],
    ['GstRegister', GstRegisterScreen],
    ['MyRazorpay', MyRazorpayScreen],
    ['Gst', GstScreen],
    ['PlanDefaults', PlanDefaultsScreen],
    ['LoginBackgrounds', LoginBackgroundsScreen],
    ['PlanCoupons', PlanCouponsScreen],
    ['PlanOverview', PlanOverviewScreen],
    ['PlanMigration', PlanMigrationScreen],
    ['MoneyRules', MoneyRulesScreen],
    ['Team', TeamScreen],
    ['AppLock', AppLockScreen],
    ['Maintenance', MaintenanceScreen],
    ['DemoLogin', DemoLoginScreen],
    ['DemoLeads', DemoLeadsScreen],
    ['QrCodes', QrCodesScreen],
    ['InsightsSettings', InsightsSettingsScreen],
    ['ServicesOverview', ServicesOverviewScreen],
    ['ServicesShop', ServicesShopScreen],
    ['ServicesInquiry', ServicesInquiryScreen],
    ['ServicesDefaults', ServicesDefaultsScreen],
    ['AlertSettings', AlertSettingsScreen],
    ['NotificationRules', NotificationRulesScreen],
    ['AuditLog', AuditLogScreen],
    ['MyAccount', MyAccountScreen],
    ['LegalPages', LegalPagesScreen],
    ['LegalPageEdit', LegalPageEditScreen],
];
const ROOT_OWN = new Set(["Admin","Inbox","Support","SupportDetail","SupportSettings","OwnerMessages","Health","ShopReadiness","System","Exports","ProfitLoss","Expenses","ExpenseForm","Login"]);
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
    return (
        <Tabs.Navigator
            // pressing any tab (even from another tab) lands on that tab's first screen, not wherever it was left
            tabBar={(props) => <FloatingTabBar {...props} defs={TABS} />}
            screenListeners={({ navigation, route }) => ({
                tabPress: (e) => {
                    if (gate.busy) { e.preventDefault(); gate.pending = route.name; return; }
                    const child = navigation.getState().routes.find((r) => r.key === route.key)?.state;
                    if (child?.key && child.index > 0) navigation.dispatch({ ...StackActions.popToTop(), target: child.key });
                },
            })}
            screenOptions={{
                headerShown: false,
                animation: 'shift',
                sceneStyleInterpolator: slideScenes,
                transitionSpec: { animation: 'timing', config: { duration: TAB_SLIDE_MS, easing: Easing.out(Easing.cubic) } },
                tabBarHideOnKeyboard: true,
                sceneStyle: { backgroundColor: t.bg },
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
        <Root.Navigator screenListeners={{ transitionStart: holdGate, transitionEnd: releaseGate }} screenOptions={({ route }) => (route.params?.noAnim ? { ...STACK_OPTIONS, animation: 'none' } : STACK_OPTIONS)}>
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
                    <Root.Screen name="Expenses" component={ExpensesScreen} />
                    <Root.Screen name="ExpenseForm" component={ExpenseFormScreen} />
                </>
            ) : <Root.Screen name="Login" component={LoginScreen} options={{ animation: 'fade' }} />}
        </Root.Navigator>
    );
}
