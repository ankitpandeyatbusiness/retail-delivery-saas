// The rider's four tabs: Home (duty and orders) · History · Money (cash and pay) · Profile. The delivery page (RiderTrip) opens on top of them and is
// registered in AppNavigator's stack. Same floating bar as the customer and owner tabs.
import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useBrand } from '../components/common/kit';
import { useRiderStore } from '../store/riders/useRiderStore';
import { FloatingTabBar } from './tabKit';
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

export default function RiderTabs() {
    const { background } = useBrand();
    const offers = useRiderStore((s) => s.offers.length);   // a new order shows as a number on Home
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <Tab.Navigator
                initialRouteName="RiderHomeTab"
                tabBar={(props) => <FloatingTabBar {...props} defs={TABS} />}
                screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: background }, tabBarHideOnKeyboard: true }}
            >
                {Object.entries(TABS).map(([name, def]) => (
                    <Tab.Screen
                        key={name}
                        name={name}
                        component={def.component}
                        options={{ title: def.label, tabBarBadge: name === 'RiderHomeTab' && offers > 0 ? offers : undefined }}
                    />
                ))}
            </Tab.Navigator>
        </View>
    );
}
