// The owner's tabs (a user with role "admin"): Home · Orders · Menu · Riders · Money.
// Same floating bar, highlight and page motion as the customer tabs (navigation/tabKit.jsx). Everything else lives in the
// side menu (the hamburger at the top left). The pages that open on top of the tabs (Soundbox, OwnerOrder...) are registered
// in AppNavigator's stack next to the customer pages.
import React, { useEffect } from 'react';
import { View, Easing } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useBrand } from '../components/common/kit';
import { useMotion } from '../components/common/motion';
import { useOwnerStore } from '../store/owners/useOwnerStore';
import { useAlertStore, setRiderAttention } from '../store/owners/useAlertStore';
import { onNotification } from '../api/common/socket';
import { useHomeStore } from '../store/customers/useHomeStore';
import { FloatingTabBar, slideScenes, gate } from './tabKit';
import OwnerDrawer from '../components/owners/OwnerDrawer';
import BillingPrompt from '../components/owners/BillingPrompt';
import EmailPrompt from '../components/owners/EmailPrompt';
import OwnerHomeScreen from '../screens/owners/OwnerHomeScreen';
import OwnerOrdersScreen from '../screens/owners/OwnerOrdersScreen';
import OwnerMenuScreen from '../screens/owners/OwnerMenuScreen';
import OwnerRidersScreen from '../screens/owners/OwnerRidersScreen';
import OwnerTxTabScreen from '../screens/owners/OwnerTxTabScreen';

const Tab = createBottomTabNavigator();

const TABS = {
    HomeTab: { label: 'Home', icon: 'home', component: OwnerHomeScreen },
    OrdersTab: { label: 'Orders', icon: 'receipt', component: OwnerOrdersScreen },
    MenuTab: { label: 'Menu', icon: 'restaurant', component: OwnerMenuScreen },
    RidersTab: { label: 'Riders', icon: 'bicycle', component: OwnerRidersScreen },
    TxTab: { label: 'Transactions', icon: 'swap-vertical', component: OwnerTxTabScreen },
};

export default function OwnerTabs() {
    const { background } = useBrand();
    const motion = useMotion();
    const waiting = useOwnerStore((st) => st.live?.orders?.active?.placed || 0);
    const riderAttention = useAlertStore((st) => st.riderAttention);
    // a rider cancelled, reported a problem or pressed help: the Riders tab blinks until the owner opens it
    useEffect(() => onNotification((n) => {
        if (n?.type === 'rider_problem' || n?.type === 'rider_sos' || (n?.type === 'order_cancelled' && n.data?.byRider)) setRiderAttention(true);
    }), []);
    // the shop's config (open / paused, labels) is read by the header; the customer tabs load it in MainTabs
    useEffect(() => { useHomeStore.getState().load(); }, []);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <Tab.Navigator
                initialRouteName="HomeTab"
                backBehavior="initialRoute"
                screenListeners={({ route }) => ({
                    // do not start a tab switch on top of a page that is still sliding (see tabKit)
                    focus: () => { if (route.name === 'RidersTab') setRiderAttention(false); },
                    tabPress: (e) => { if (gate.busy) { e.preventDefault(); gate.pending = route.name; } },
                })}
                tabBar={(props) => <FloatingTabBar {...props} defs={TABS} />}
                screenOptions={{
                    headerShown: false,
                    sceneStyle: { backgroundColor: background },
                    tabBarHideOnKeyboard: true,
                    lazy: false,   // all five tabs are ready, so a tab never shows an empty page while it slides in
                    animation: motion === 'off' ? 'none' : 'shift',
                    sceneStyleInterpolator: motion === 'off' ? undefined : slideScenes,
                    transitionSpec: { animation: 'timing', config: { duration: 300, easing: Easing.out(Easing.cubic) } },
                }}
            >
                {Object.entries(TABS).map(([name, def]) => (
                    <Tab.Screen
                        key={name}
                        name={name}
                        component={def.component}
                        options={{ title: def.label, tabBarBadge: name === 'OrdersTab' ? (waiting > 0 ? waiting : undefined) : name === 'RidersTab' && riderAttention ? 'dot' : undefined }}
                    />
                ))}
            </Tab.Navigator>
            <OwnerDrawer />
            <BillingPrompt />
            <EmailPrompt />
        </View>
    );
}
