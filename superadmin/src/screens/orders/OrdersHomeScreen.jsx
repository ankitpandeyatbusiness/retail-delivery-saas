import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Segmented } from '../../components/inputs';
import OrdersList from '../../components/OrdersList';
import ComplaintsList from '../../components/ComplaintsList';

// The Orders tab: every order and every complaint of every shop.
export default function OrdersHomeScreen() {
    const nav = useNavigation();
    const [tab, setTab] = useState('orders');

    const switcher = (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'orders', label: 'Orders' }, { value: 'complaints', label: 'Complaints' }]} />
        </View>
    );

    return (
        <Screen
            tabScreen
            title="Orders"
            subtitle="Across every shop"
            scroll={false}
            right={<HeaderButton icon="chart" onPress={() => nav.navigate('SalesReport', {})} />}
        >
            {tab === 'orders' ? <OrdersList header={switcher} /> : (
                <View style={{ flex: 1 }}>
                    {switcher}
                    <ComplaintsList />
                </View>
            )}
        </Screen>
    );
}
