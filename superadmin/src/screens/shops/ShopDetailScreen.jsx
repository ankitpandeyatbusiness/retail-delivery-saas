import React, { useCallback, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { FOLDERS } from './shopFolders';
import ShopAreaMap from '../../components/ShopAreaMap';
import SetupCard from '../../components/setupCard';
import { Card, ListRow, SectionTitle, KeyValue, Avatar, Badge, Button } from '../../components/ui';
import { ShopStateBadge, stateTone } from '../../components/shopBits';
import { Hero, QuickActions, SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { useShopStore } from '../../store/useShopStore';
import { dateOnly, rupees } from '../../utils/format';
import { ZoomImage } from '../../components/ImageViewer';

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
    const planId = tenant.plan?.id;
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
                    ? <ZoomImage source={{ uri: rec.appIcon || tenant.logo }} style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
                    : <Avatar name={tenant.name} size={56} />}
            >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <ShopStateBadge shop={shop} />
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

            {tenant.status !== 'active' ? (
                <Card style={{ marginTop: spacing.md }} onPress={go('ShopClose')}>
                    <Text style={{ color: t.danger, fontWeight: '800', fontSize: font.md }}>This shop is closed</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>Tap to see why and to open it again.</Text>
                </Card>
            ) : null}

            <SetupCard shopId={shopId} name={tenant.name} />

            <View style={{ marginTop: spacing.xl, marginBottom: spacing.lg }}>
                {noArea ? (
                <Card style={{ marginBottom: spacing.lg }}>
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

            {Number.isFinite(d.latitude) && Number.isFinite(d.longitude) ? (
                <View style={{ marginBottom: spacing.md }}><ShopAreaMap latitude={d.latitude} longitude={d.longitude} radiusKm={d.radiusKm} onPress={go('ShopEdit')} /></View>
            ) : null}

            <SectionTitle section="settings">Everything about this shop</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                {FOLDERS.slice(0, 3).map((f) => (
                    <ListRow key={f.key} section={f.section} icon={f.icon} title={f.title} subtitle={f.subtitle} onPress={() => nav.navigate('ShopFolder', { shopId, name: tenant.name, folder: f.key })} />
                ))}
                <ListRow section="settings" icon="tune" title="Settings" subtitle="How this shop works: ordering, hours, riders, features and how the customer app looks" onPress={go('ShopSettings')} />
                {FOLDERS.slice(3).map((f, i, arr) => (
                    <ListRow key={f.key} section={f.section} icon={f.icon} title={f.title} subtitle={f.subtitle} onPress={() => nav.navigate('ShopFolder', { shopId, name: tenant.name, folder: f.key })} last={i === arr.length - 1} />
                ))}
            </Card>

            <SectionTitle section="money">Plan</SectionTitle>
            <Card>
                <Text style={{ color: t.muted }}>Plan, free days, extras, wallet and the website and app switches.</Text>
                <Button title="Open the plan" kind="soft" icon="star" onPress={() => nav.navigate('ShopPlan', { shopId, name: tenant.name })} style={{ marginTop: spacing.sm }} />
            </Card>

            <SectionTitle section="platform">Details</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Phone" value={tenant.phone} />
                <KeyValue label="Address" value={[tenant.address?.line, tenant.address?.city, tenant.address?.pincode].filter(Boolean).join(', ')} />
                <KeyValue label="Android package" value={tenant.androidPackage} />
                <KeyValue label="Plan" value={planId ? planId[0].toUpperCase() + planId.slice(1) : 'No plan yet'} last />
            </Card>
        </Screen>
    );
}
