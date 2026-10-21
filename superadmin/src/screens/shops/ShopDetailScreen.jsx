import React, { useCallback, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { BroughtByCard, HandoverCard } from '../../components/settlementBits';
import { Card, ListRow, SectionTitle, KeyValue, Avatar, Badge, Button } from '../../components/ui';
import { ShopStateBadge, stateTone } from '../../components/shopBits';
import { Hero, QuickActions, SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { useShopStore } from '../../store/useShopStore';
import { dateOnly, rupees } from '../../utils/format';

// The hub of one shop. Big shortcuts on top for the common jobs, then focused groups: nothing is crowded.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (p) => { const [y, m] = String(p).split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };

export default function ShopDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const error = useShopStore((s) => s.errors[shopId]);
    const [refreshing, setRefreshing] = useState(false);

    useFocusEffect(useCallback(() => { useShopStore.getState().load(shopId, { quiet: true }); }, [shopId]));

    const refresh = async () => { setRefreshing(true); await useShopStore.getState().load(shopId, { quiet: true }); setRefreshing(false); };

    if (!rec) {
        return (
            <Screen title={name || 'Shop'}>
                {error ? <ErrorBox message={error} onRetry={() => useShopStore.getState().load(shopId)} /> : <SkeletonList count={3} />}
            </Screen>
        );
    }

    const { tenant, state } = rec;
    const go = (screen) => () => nav.navigate(screen, { shopId, name: tenant.name });
    const shop = { ...tenant, state };
    const tone = stateTone(shop);
    const section = { success: 'money', warn: 'catalog', danger: 'alerts' }[tone];
    const billing = tenant.billing?.state;
    const takesDelivery = (rec.resolved?.orders?.types || tenant.settings?.orders?.types || ['delivery']).includes('delivery');
    const d = tenant.delivery || {};
    const noArea = takesDelivery && !([d.latitude, d.longitude, d.radiusKm].every((n) => Number.isFinite(n)) && d.radiusKm > 0);

    return (
        <Screen title={tenant.name} subtitle={tenant.slug} refreshing={refreshing} onRefresh={refresh}>
            <Hero
                section={section}
                title={tenant.name}
                subtitle={[tenant.address?.city, `Since ${dateOnly(tenant.createdAt)}`].filter(Boolean).join(' · ')}
                leading={(rec.appIcon || tenant.logo)
                    ? <Image source={{ uri: rec.appIcon || tenant.logo }} style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
                    : <Avatar name={tenant.name} size={56} />}
            >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <ShopStateBadge shop={shop} />
                    {billing === 'paused' || billing === 'grace' ? <Badge label={`Rent ${billing}`} tone={billing === 'paused' ? 'danger' : 'warn'} icon="receipt" /> : null}
                </View>
                {state?.reasons?.length ? (
                    <View style={{ marginTop: spacing.md }}>
                        {state.reasons.map((r) => (
                            <Text key={r.code} style={{ color: t.text, fontSize: font.sm, marginTop: 4 }}>
                                • {r.label}{r.note ? ` — ${r.note}` : ''}{r.setBy === 'owner' ? ' (by owner)' : ''}
                            </Text>
                        ))}
                    </View>
                ) : null}
            </Hero>

            <View style={{ marginTop: spacing.xl, marginBottom: spacing.lg }}>
                {noArea ? (
                <Card>
                    <Text style={{ color: t.warn, fontWeight: '800', fontSize: font.md }}>Delivery is on, but no delivery area is set</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4, lineHeight: 19 }}>Without a map pin and a radius, a customer anywhere can order delivery from this shop. Set the shop pin and the distance it delivers within.</Text>
                    <Button title="Set the delivery area" kind="soft" small icon="map" onPress={go('ShopEdit')} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} />
                </Card>
            ) : null}

            <QuickActions
                    items={[
                        { label: 'Live activity', icon: 'live', section: 'orders', onPress: go('ShopLive') },
                        { label: 'Orders', icon: 'orders', section: 'catalog', onPress: go('ShopOrders') },
                        { label: 'Menu', icon: 'food', section: 'money', onPress: go('ShopMenu') },
                        { label: 'App settings', icon: 'tune', section: 'settings', onPress: go('ShopSettings') },
                    ]}
                />
            </View>

            <BroughtByCard shopId={shopId} current={tenant.broughtBy} onChanged={refresh} />
            <HandoverCard shopId={shopId} handedOverAt={tenant.handedOverAt} onChanged={refresh} />

            <SectionTitle section="orders">Operations</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="money" icon="chart" title="Progress report" subtitle="How this shop is doing: sales, customers, food, riders, tips" onPress={() => nav.navigate('ShopReport', { shopId, name: tenant.name })} />
                <ListRow section="platform" icon="megaphone" title="Autopilot" subtitle="Reminders this shop sends its customers: what it did, stop it" onPress={() => nav.navigate('ShopAutopilot', { shopId, name: tenant.name })} />
                <ListRow section="orders" icon="orders" title="Orders" subtitle="Every order of this shop, with status and rider" onPress={go('ShopOrders')} />
                <ListRow section="riders" icon="rider" title="Riders and cash" subtitle="Riders, cash they hold, performance" onPress={go('ShopRiders')} />
                <ListRow section="alerts" icon="message" title="Complaints" subtitle="Answer and refund customer complaints" onPress={go('ShopComplaints')} />
                <ListRow section="platform" icon="megaphone" title="Messages to customers" subtitle="Tell customers and riders something" onPress={go('ShopMessages')} />
                <ListRow section="settings" icon="notes" title="Activity log" subtitle="Who changed what in this shop" onPress={go('ShopActivity')} />
                <ListRow section="money" icon="chart" title="Sales report" subtitle="Sales per day, items, payments" onPress={() => nav.navigate('SalesReport', { shopId, name: tenant.name })} last />
            </Card>

            <SectionTitle section="money">Money</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="money" icon="bank" title="Billing and rent" subtitle="Go live, free limits, bill preview, pricing" onPress={go('ShopBilling')} />
                <ListRow section="people" icon="receipt" title="Rent invoices" subtitle="Bills sent to this shop" onPress={() => nav.navigate('Invoices', { shopId, name: tenant.name })} />
                <ListRow section="orders" icon="wallet" title="Online payments" subtitle="Razorpay setup, money, refunds, chargebacks" onPress={go('ShopPayments')} />
                <ListRow section="catalog" icon="message" title="SMS wallet" subtitle="Balance, top-ups, prices, own sender" onPress={go('ShopSms')} />
                <ListRow section="platform" icon="chart" title="Transactions" subtitle="Every money movement of this shop" onPress={() => nav.navigate('Ledger', { shopId, name: tenant.name })} last />
            </Card>

            <SectionTitle section="people">People</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="money" icon="key" title="Owners" subtitle="Who can run this shop" onPress={go('ShopOwners')} />
                <ListRow section="people" icon="users" title="Users" subtitle="Customers, riders and owners" onPress={go('ShopUsers')} last />
            </Card>

            <SectionTitle section="catalog">Catalog</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="catalog" icon="food" title="Menu" subtitle="Items, categories, stock, CSV import" onPress={go('ShopMenu')} />
                <ListRow section="catalog" icon="sparkle" title="Collections" subtitle="Festival specials and combo deals" onPress={go('Collections')} />
                <ListRow section="catalog" icon="banner" title="Banners" subtitle="Offer cards on the home screen" onPress={go('Banners')} />
                <ListRow section="money" icon="coupon" title="Coupons" subtitle="Discount codes" onPress={go('Coupons')} last />
            </Card>

            <SectionTitle section="settings">Customer app</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="settings" icon="tune" title="App settings" subtitle="Veg switch, home layout, tabs, fees, hours, riders" onPress={go('ShopSettings')} />
                <ListRow section="catalog" icon="palette" title="Branding" subtitle="Logo, home pictures, colours from logo, app icon" onPress={go('ShopBranding')} last />
            </Card>

            <SectionTitle section="alerts">Manage</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="settings" icon="edit" title="Edit shop" subtitle="Name, contact, address, delivery, GST" onPress={go('ShopEdit')} />
                <ListRow section="platform" icon="bell" title="Message the owner" subtitle="A notice in the owner's app" onPress={go('ShopNotify')} />
                <ListRow section="alerts" icon="shield" title="Access and maintenance" subtitle="Block owner panel, pause the shop" onPress={go('ShopAccess')} />
                <ListRow section="platform" icon="tool" title="Development details" subtitle="App id, versions, Razorpay, SMS and DLT, build commands" onPress={go('ShopDev')} last />
            </Card>

            {rec.rent ? (
                <>
                    <SectionTitle section="money">Rent</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Now" value={{ not_live: 'Not live yet', free: 'Free period', paying: 'Paying', grace: 'Bill unpaid (grace)', paused: 'Paused: unpaid bill' }[rec.rent.stage]} />
                        {rec.rent.stage === 'free' ? <KeyValue label="Free orders left" value={String(rec.rent.free.ordersLeft)} /> : null}
                        {rec.rent.stage === 'free' ? <KeyValue label="Free period ends by" value={dateOnly(rec.rent.free.endsAt)} /> : null}
                        {rec.rent.stage === 'free' && rec.rent.first ? <KeyValue label="First rent for" value={monthName(rec.rent.first.period)} /> : null}
                        {rec.rent.next ? <KeyValue label="Month being counted" value={monthName(rec.rent.next.period)} /> : null}
                        {rec.rent.next ? <KeyValue label="Orders so far" value={String(rec.rent.next.orders)} /> : null}
                        {rec.rent.next ? <KeyValue label="Rent so far" value={rupees(rec.rent.next.total)} /> : null}
                        {rec.rent.next ? <KeyValue label="Billed on" value={dateOnly(rec.rent.next.billedOn)} /> : null}
                        <KeyValue label={rec.rent.custom ? 'This shop\'s own plan' : 'Platform plan'} value={rec.rent.plan} last />
                    </Card>
                    <Button title="Open rent and plan" kind="soft" icon="receipt" onPress={() => nav.navigate('ShopBilling', { shopId, name: tenant.name })} style={{ marginTop: spacing.sm }} />
                </>
            ) : null}

            <SectionTitle section="platform">Details</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Phone" value={tenant.phone} />
                <KeyValue label="Address" value={[tenant.address?.line, tenant.address?.city, tenant.address?.pincode].filter(Boolean).join(', ')} />
                <KeyValue label="Android package" value={tenant.androidPackage} />
                <KeyValue label="Rent billing" value={billing ? billing[0].toUpperCase() + billing.slice(1) : null} last />
            </Card>
        </Screen>
    );
}
