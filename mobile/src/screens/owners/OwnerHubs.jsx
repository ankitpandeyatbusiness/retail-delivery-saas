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
import { tr, tl } from '../../i18n';

export const OwnerMoneyHub = () => (
    <TabsHost title={tr('Transactions')} tabs={[['all', tl('All money'), OwnerTxTabScreen], ['months', tl('By month'), OwnerTransactionsScreen], ['refunds', tl('Refunds and chargebacks'), OwnerPaymentsScreen]]} />
);
export const OwnerShopFrontHub = () => (
    <TabsHost title={tr('Home screen')} tabs={[['banners', 'Banners', OwnerBannersScreen], ['collections', 'Collections', OwnerCollectionsScreen], ['pictures', tl('Login pictures'), OwnerHeroScreen]]} />
);
export const OwnerBillsHub = () => (
    <TabsHost title={tr('Bills and SMS')} tabs={[['bill', 'Old bills', OwnerRentScreen], ['sms', 'SMS', OwnerSmsScreen]]} />
);
export const OwnerDeliveryHub = () => (
    <TabsHost title={tr('Delivery')} tabs={[['area', tl('Area and fees'), OwnerDeliveryScreen], ['rules', tl('Rules and cash'), OwnerRiderRulesScreen]]} />
);
export const OwnerReportsHub = () => (
    <TabsHost title={tr('Business report')} tabs={[['report', tl('Report'), OwnerBusinessScreen], ['popular', 'Popular items', OwnerPopularScreen]]} />
);
export const OwnerInboxHub = () => (
    <TabsHost title={tr('Inbox and activity')} tabs={[['inbox', tl('Inbox'), OwnerNotificationsScreen], ['activity', 'Activity log', OwnerActivityScreen]]} />
);
