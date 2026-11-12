// The rider's four tabs: Home (duty and orders) · History · Money (cash and pay) · Profile. The delivery page (RiderTrip) opens on top of them and is
// registered in AppNavigator's stack. Same floating bar as the customer and owner tabs.
import React, { useEffect } from 'react';
import { View, Easing } from 'react-native';
import { onOfferClosed } from '../api/common/socket';
import OfferPopup from '../components/riders/OfferPopup';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useBrand } from '../components/common/kit';
import { useRiderDesktop } from '../utils/common/layout';
import { useRiderStore } from '../store/riders/useRiderStore';
import { FloatingTabBar, slideScenes, gate } from './tabKit';
import { useMotion } from '../components/common/motion';
import RiderHomeScreen from '../screens/riders/RiderHomeScreen';
import RiderHistoryScreen from '../screens/riders/RiderHistoryScreen';
import RiderMoneyScreen from '../screens/riders/RiderMoneyScreen';
import RiderProfileScreen from '../screens/riders/RiderProfileScreen';

const Tab = createBottomTabNavigator();

const TABS = {
    RiderHomeTab: { label: 'Home', icon: 'bicycle', component: RiderHomeScreen },
    RiderHistoryTab: { label: 'History', icon: 'time', component: RiderHistoryScreen },
    RiderMoneyTab: { label: 'Money', icon: 'wallet', component: RiderMoneyScreen },
    RiderProfileTab: { label: 'Profile', icon: 'person', component: RiderProfileScreen },
};

import { GREY } from '../components/customers/shop';
import { useHomeStore } from '../store/customers/useHomeStore';

export default function RiderTabs() {
    const { background } = useBrand();
    const deskRider = useRiderDesktop();   // on a computer the sidebar replaces the bottom bar
    const motion = useMotion();
    const offers = useRiderStore((s) => s.offers.length);   // a new order shows as a number on Home
    const missedNew = useRiderStore((s) => s.missedNew);    // red blinking dot on History: an offer ran out unanswered
    // The shop's order switch is off (by the owner, by itself, by maintenance or by its hours): the whole rider app turns grey, like the customer's,
    // unless he still carries a delivery or has an offer to answer (those are never greyed out: he must see them to finish them).
    const shopClosed = useHomeStore((s) => s.full?.restaurant?.isOpen === false);
    const inHand = useRiderStore((s) => s.active.length + s.offers.length > 0);
    const grey = shopClosed && !inHand;
    // someone else took the order, or the request closed: the list (and the popup) update at once
    useEffect(() => onOfferClosed(() => useRiderStore.getState().load()), []);
    return (
        <View style={[{ flex: 1, backgroundColor: background }, grey ? GREY : null]}>
            {/* a new order: buzz and a popup with the map and Accept, whichever tab he is on */}
            <OfferPopup />
            <Tab.Navigator
                initialRouteName="RiderHomeTab"
                backBehavior="initialRoute"
                screenListeners={({ route }) => ({
                    // do not start a tab switch on top of a page that is still sliding (see tabKit)
                    tabPress: (e) => { if (gate.busy) { e.preventDefault(); gate.pending = route.name; } },
                })}
                tabBar={deskRider ? () => null : (props) => <FloatingTabBar {...props} defs={TABS} />}
                screenOptions={{
                    headerShown: false,
                    sceneStyle: { backgroundColor: background },
                    tabBarHideOnKeyboard: true,
                    lazy: false,   // every tab is ready, so a tab never shows an empty page while it slides in
                    animation: motion === 'off' ? 'none' : 'shift',   // the pages slide with the tabs, like the owner panel
                    sceneStyleInterpolator: motion === 'off' ? undefined : slideScenes,
                    transitionSpec: { animation: 'timing', config: { duration: 300, easing: Easing.out(Easing.cubic) } },
                }}
            >
                {Object.entries(TABS).map(([name, def]) => (
                    <Tab.Screen
                        key={name}
                        name={name}
                        component={def.component}
                        options={{ title: def.label, tabBarBadge: name === 'RiderHomeTab' && offers > 0 ? offers : name === 'RiderHistoryTab' && missedNew > 0 ? 'dot' : undefined }}
                    />
                ))}
            </Tab.Navigator>
        </View>
    );
}
