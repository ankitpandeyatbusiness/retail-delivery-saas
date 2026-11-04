import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Segmented } from '../../components/inputs';
import OrdersList from '../../components/OrdersList';
import ComplaintsList from '../../components/ComplaintsList';
import { AttentionList, LiveBoard } from '../../components/OrdersWatch';

// The Orders tab, a control room: what is in trouble, what is running, every order, and complaints.
export default function OrdersHomeScreen() {
    const nav = useNavigation();
    const [tab, setTab] = useState('attention');

    const switcher = (
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <Segmented
                value={tab}
                onChange={setTab}
                options={[
                    { value: 'attention', label: 'Attention' },
                    { value: 'live', label: 'Live' },
                    { value: 'orders', label: 'All' },
                    { value: 'complaints', label: 'Complaints' },
                ]}
            />
        </View>
    );

    return (
        <Screen
            tabScreen
            title="Orders"
            subtitle="Across every shop"
            scroll={false}
            right={(
                <View style={{ flexDirection: 'row' }}>
                    <HeaderButton icon="settings" onPress={() => nav.navigate('OrderLimits')} />
                    <HeaderButton icon="chart" onPress={() => nav.navigate('SalesReport', {})} />
                </View>
            )}
        >
            {tab === 'attention' ? <AttentionList header={switcher} />
                : tab === 'live' ? <LiveBoard header={switcher} />
                : tab === 'orders' ? <OrdersList header={switcher} /> : (
                    <View style={{ flex: 1 }}>
                        {switcher}
                        <ComplaintsList />
                    </View>
                )}
        </Screen>
    );
}
