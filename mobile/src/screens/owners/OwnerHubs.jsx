// The merged pages of the shop menu. Each is a few screens that belong together, shown as tabs under one title (components/owners/TabsHost.jsx).
import React from 'react';
import TabsHost from '../../components/owners/TabsHost';
import OwnerTxTabScreen from './OwnerTxTabScreen';
import OwnerTransactionsScreen from './OwnerTransactionsScreen';
import OwnerPaymentsScreen from './OwnerPaymentsScreen';
import OwnerBannersScreen from './OwnerBannersScreen';
import OwnerCollectionsScreen from './OwnerCollectionsScreen';
import OwnerHeroScreen from './OwnerHeroScreen';
import OwnerRentScreen from './OwnerRentScreen';
import OwnerSmsScreen from './OwnerSmsScreen';
import OwnerDeliveryScreen from './OwnerDeliveryScreen';
import OwnerRiderRulesScreen from './OwnerRiderRulesScreen';
import OwnerBusinessScreen from './OwnerBusinessScreen';
import OwnerPopularScreen from './OwnerPopularScreen';
import OwnerNotificationsScreen from './OwnerNotificationsScreen';
import OwnerActivityScreen from './OwnerActivityScreen';

export const OwnerMoneyHub = () => (
    <TabsHost title="Transactions" tabs={[['all', 'All money', OwnerTxTabScreen], ['months', 'By month', OwnerTransactionsScreen], ['refunds', 'Refunds and chargebacks', OwnerPaymentsScreen]]} />
);
export const OwnerShopFrontHub = () => (
    <TabsHost title="Home screen" tabs={[['banners', 'Banners', OwnerBannersScreen], ['collections', 'Collections', OwnerCollectionsScreen], ['pictures', 'Login pictures', OwnerHeroScreen]]} />
);
export const OwnerBillsHub = () => (
    <TabsHost title="Bills and SMS" tabs={[['bill', 'Monthly bill', OwnerRentScreen], ['sms', 'SMS', OwnerSmsScreen]]} />
);
export const OwnerDeliveryHub = () => (
    <TabsHost title="Delivery" tabs={[['area', 'Area and fees', OwnerDeliveryScreen], ['rules', 'Rules and cash', OwnerRiderRulesScreen]]} />
);
export const OwnerReportsHub = () => (
    <TabsHost title="Business report" tabs={[['report', 'Report', OwnerBusinessScreen], ['popular', 'Popular items', OwnerPopularScreen]]} />
);
export const OwnerInboxHub = () => (
    <TabsHost title="Inbox and activity" tabs={[['inbox', 'Inbox', OwnerNotificationsScreen], ['activity', 'Activity log', OwnerActivityScreen]]} />
);
