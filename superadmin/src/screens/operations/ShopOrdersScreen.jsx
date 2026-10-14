import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, HeaderButton } from '../../components/layout';
import OrdersList from '../../components/OrdersList';

// The orders of one shop: the same list as the Orders tab, fixed to this shop.
export default function ShopOrdersScreen() {
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    return (
        <Screen
            title="Orders"
            subtitle={name}
            scroll={false}
            right={<HeaderButton icon="chart" onPress={() => nav.navigate('SalesReport', { shopId, name })} />}
        >
            <OrdersList tenantId={shopId} showShop={false} />
        </Screen>
    );
}
