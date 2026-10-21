// The kitchen and waiter app: two tabs, Home (the work screen) and Profile. One shell for both jobs, so the sign-in, the pause message,
// light and dark mode and the tab bar are written once. The person's job decides what Home shows.
import React, { useCallback, useEffect } from 'react';
import { AppState, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useBrand } from '../components/common/kit';
import { FloatingTabBar } from './tabKit';
import StaffHomeScreen from '../screens/staff/StaffHomeScreen';
import StaffProfileScreen from '../screens/staff/StaffProfileScreen';
import StaffBlockedView from '../components/staff/StaffBlockedView';
import { StaffSkeleton } from '../components/staff/staffBits';
import { useStaffStore } from '../store/staff/useStaffStore';
import { useKitchenStore } from '../store/staff/useKitchenStore';
import useKitchenSync from '../components/staff/useKitchenSync';
import { useWaiterStore } from '../store/staff/useWaiterStore';
import useWaiterSync from '../components/staff/useWaiterSync';
import { useAuthStore } from '../store/common/useAuthStore';
import { useStaffSoundStore } from '../store/staff/useStaffSoundStore';
import StaffAlertPopup from '../components/staff/StaffAlertPopup';
import { GREY } from '../components/customers/shop';

const Tab = createBottomTabNavigator();

const TABS = {
    StaffHomeTab: { label: 'Home', icon: 'restaurant', component: StaffHomeScreen },
    StaffProfileTab: { label: 'Profile', icon: 'person', component: StaffProfileScreen },
};

export default function StaffTabs() {
    const { background } = useBrand();
    const state = useStaffStore((s) => s.state);
    const uid = useAuthStore((s) => s.user?.id);
    const load = useStaffStore((s) => s.load);
    const role = useStaffStore((s) => s.me?.role);
    const closed = useStaffStore((s) => s.me?.dutyStatus === 'shop_closed');   // the shop is closed and this job has no work in hand: the whole app turns grey, like the customer's
    const waiting = useKitchenStore((s) => s.counts.new);   // orders waiting for Start cooking
    const todo = useWaiterStore((s) => s.counts.serve + s.counts.requests);   // dishes to serve and tables asking
    useEffect(() => { useStaffSoundStore.getState().hydrate(); }, []);   // this phone's alert settings, before the first alert
    useKitchenSync(state === 'ok' && role === 'kitchen');
    useWaiterSync(state === 'ok' && role === 'waiter');

    // a new person on this phone starts clean; coming back to the app asks again (the owner may have paused them meanwhile)
    useEffect(() => { useStaffStore.getState().reset(); require('../store/staff/useStaffAlertStore').useStaffAlertStore.getState().clear(); useKitchenStore.getState().reset(); useWaiterStore.getState().reset(); load(); }, [uid, load]);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => sub.remove();
    }, [load]);
    // the shop opens or closes, or the last order is finished, while the app is open: ask again every minute
    useEffect(() => {
        const t = setInterval(() => { if (AppState.currentState === 'active') load(); }, 60000);
        return () => clearInterval(t);
    }, [load]);
    const retry = useCallback(() => { useStaffStore.setState({ state: 'loading' }); load(); }, [load]);

    if (state === 'loading') return <StaffSkeleton />;
    if (state === 'blocked' || state === 'error') return <StaffBlockedView onRetry={retry} />;
    return (
        <View style={[{ flex: 1, backgroundColor: background }, closed ? GREY : null]}>
            <Tab.Navigator
                initialRouteName="StaffHomeTab"
                tabBar={(props) => <FloatingTabBar {...props} defs={TABS} />}
                screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: background }, tabBarHideOnKeyboard: true }}
            >
                {Object.entries(TABS).map(([name, def]) => (
                    <Tab.Screen key={name} name={name} component={def.component} options={{ title: def.label, tabBarBadge: name === 'StaffHomeTab' ? (role === 'kitchen' ? waiting : role === 'waiter' ? todo : 0) || undefined : undefined }} />
                ))}
            </Tab.Navigator>
            <StaffAlertPopup />
        </View>
    );
}
