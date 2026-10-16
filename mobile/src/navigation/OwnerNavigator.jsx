// The owner's tabs (a user with role "admin"): Home · Orders · Menu · Riders · Money.
// Everything else lives in the Shop hub, opened from the shop logo. The pages that open on top of the tabs
// (ShopHub, Soundbox, OwnerOrder...) are registered in AppNavigator's stack next to the customer pages.
import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../components/common/kit';
import { useOwnerStore } from '../store/owners/useOwnerStore';
import { useHomeStore } from '../store/customers/useHomeStore';
import OwnerHomeScreen from '../screens/owners/OwnerHomeScreen';
import OwnerOrdersScreen from '../screens/owners/OwnerOrdersScreen';
import { OwnerMenuScreen, OwnerRidersScreen, OwnerMoneyScreen } from '../screens/owners/OwnerStubScreens';

const Tab = createBottomTabNavigator();

const TABS = {
    HomeTab: { label: 'Home', icon: 'home', component: OwnerHomeScreen },
    OrdersTab: { label: 'Orders', icon: 'receipt', component: OwnerOrdersScreen },
    MenuTab: { label: 'Menu', icon: 'restaurant', component: OwnerMenuScreen },
    RidersTab: { label: 'Riders', icon: 'bicycle', component: OwnerRidersScreen },
    MoneyTab: { label: 'Money', icon: 'wallet', component: OwnerMoneyScreen },
};

function Bar({ state, navigation }) {
    const insets = useSafeAreaInsets();
    const { primary, surface, border, muted, background, dark, error } = useBrand();
    const waiting = useOwnerStore((st) => st.live?.orders?.active?.placed || 0);
    return (
        <View style={{ backgroundColor: background, paddingHorizontal: 12, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4 }}>
            <View style={[s.bar, { backgroundColor: surface, borderColor: border, shadowColor: dark ? '#000000' : primary }]}>
                {state.routes.map((route, i) => {
                    const focused = state.index === i;
                    const def = TABS[route.name];
                    const color = focused ? primary : muted;
                    const badge = route.name === 'OrdersTab' ? waiting : 0;
                    const press = () => {
                        const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                        if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
                    };
                    return (
                        <Pressable key={route.key} onPress={press} style={s.item} accessibilityRole="button" accessibilityState={focused ? { selected: true } : {}}>
                            <View style={[s.pill, focused && { backgroundColor: alpha(primary, 0.14) }]}>
                                <View>
                                    <Ionicons name={focused ? def.icon : `${def.icon}-outline`} size={22} color={color} />
                                    {badge > 0 ? (
                                        <View style={[s.badge, { backgroundColor: error }]}><Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>
                                    ) : null}
                                </View>
                                <Text numberOfLines={1} style={{ color, fontSize: 10.5, fontWeight: '800', marginTop: 2 }}>{def.label}</Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

export default function OwnerTabs() {
    const { background } = useBrand();
    // the shop's config (open / paused, labels) is read by the header; the customer tabs load it in MainTabs
    useEffect(() => { useHomeStore.getState().load(); }, []);
    return (
        <Tab.Navigator
            initialRouteName="HomeTab"
            backBehavior="initialRoute"
            tabBar={(props) => <Bar {...props} />}
            screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: background } }}
        >
            {Object.entries(TABS).map(([name, def]) => (
                <Tab.Screen key={name} name={name} component={def.component} options={{ title: def.label }} />
            ))}
        </Tab.Navigator>
    );
}

const s = StyleSheet.create({
    bar: {
        flexDirection: 'row', alignItems: 'center', height: 68, borderRadius: 34, borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 6, shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
    },
    item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pill: { alignItems: 'center', justifyContent: 'center', borderRadius: 24, paddingHorizontal: 12, paddingVertical: 7, minWidth: 58 },
    badge: { position: 'absolute', top: -5, right: -9, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
});
