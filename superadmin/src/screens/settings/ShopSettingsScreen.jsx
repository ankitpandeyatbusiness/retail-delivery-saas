import React, { useEffect, useMemo } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import { Card, ListRow, SectionTitle } from '../../components/ui';
import { AppPreview } from '../../components/settingsPage';
import { Loading, ErrorBox } from '../../components/feedback';
import { useShopStore } from '../../store/useShopStore';
import { useOptionsStore } from '../../store/useOptionsStore';
import { effectiveSettings, nameOf } from '../../utils/settings';
import { spacing } from '../../theme';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// The hub of the customer app's configuration: one row per group of settings, each with a one-line summary.
export default function ShopSettingsScreen() {
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const { options, defaults, presets, error } = useOptionsStore();

    useEffect(() => {
        useShopStore.getState().load(shopId, { quiet: !!rec });
        useOptionsStore.getState().load();
    }, [shopId]);   // eslint-disable-line react-hooks/exhaustive-deps

    const eff = useMemo(
        () => (rec && options ? effectiveSettings({ tenant: rec.tenant, resolved: rec.resolved, options, defaults, presets }) : null),
        [rec, options, defaults, presets],
    );

    if (!eff) {
        return <Screen title="Customer app" subtitle={name}>{error ? <ErrorBox message={error} onRetry={() => useOptionsStore.getState().load()} /> : <Loading />}</Screen>;
    }

    const go = (screen) => () => nav.navigate(screen, { shopId, name });
    const onFeatures = Object.values(eff.features).filter(Boolean).length;
    const openDays = DAYS.filter((d) => (eff.hours.weekly[d] || []).length).length;
    const fee = eff.orders.deliveryFee || {};
    const enabledBlocks = eff.home.blocks.filter((b) => b.enabled).length;

    return (
        <Screen title="Customer app" subtitle={name}>
            <AppPreview config={rec.resolved} />

            <SectionTitle section="settings">Look and layout</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="settings" icon="palette" title="Brand and look" subtitle={`${eff.brand.colors.primary || 'Colours from logo'} · ${nameOf('shape', eff.brand.buttonShape)} buttons`} onPress={go('SettingsBrand')} />
                <ListRow section="settings" icon="menu" title="Bottom tabs" subtitle={eff.tabs.map((t) => nameOf('tab', t)).join(' · ')} onPress={go('SettingsTabs')} />
                <ListRow section="settings" icon="home" title="Home layout" subtitle={`${nameOf('foodMode', eff.home.foodMode)} · ${enabledBlocks} blocks · ${nameOf('cardStyle', eff.home.cardStyle)}`} onPress={go('SettingsHome')} />
                <ListRow section="settings" icon="message" title="Words and language" subtitle={nameOf('language', eff.labels.language)} onPress={go('SettingsLabels')} last />
            </Card>

            <SectionTitle section="catalog">Features and menu</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="catalog" icon="tune" title="App features" subtitle={`${onFeatures} switched on · veg switch ${eff.features.vegToggle ? 'on' : 'off'}`} onPress={go('SettingsFeatures')} />
                <ListRow section="catalog" icon="coupon" title="Menu and offers" subtitle={`Out of stock: ${nameOf('outOfStock', eff.menu.outOfStock).toLowerCase()} · coupons ${eff.offers.couponsEnabled ? 'on' : 'off'}`} onPress={go('SettingsMenuOffers')} />
                <ListRow section="catalog" icon="coupon" title="Points and rewards" subtitle="Customer points, rider points and badges" onPress={go('SettingsPoints')} last />
            </Card>

            <SectionTitle section="orders">Ordering</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow
                    section="orders"
                    icon="orders"
                    title="Orders and fees"
                    subtitle={`${(eff.orders.types || []).map((t) => nameOf('orderType', t)).join(', ')} · min ₹${eff.orders.minOrder || 0} · fee ${nameOf('fee', fee.type || 'free').toLowerCase()}`}
                    onPress={go('SettingsOrders')}
                />
                <ListRow section="orders" icon="orders" title="Dine in and pickup rules" subtitle={`Dine in ${eff.orders.dineIn?.enabled ? 'on' : 'off'} · pickup waiting ${eff.orders.pickupRules?.openMax ?? 2} · delivery at once ${eff.orders.mixRules?.deliveryOpenMax ?? 3}`} onPress={go('SettingsDineIn')} />
                <ListRow section="orders" icon="clock" title="Opening hours" subtitle={openDays ? `Open ${openDays} day${openDays > 1 ? 's' : ''} a week${eff.hours.closedDates.length ? ` · ${eff.hours.closedDates.length} holiday(s)` : ''}` : 'Always open'} onPress={go('SettingsHours')} />
                <ListRow section="riders" icon="rider" title="Riders and delivery" subtitle={`${nameOf('assign', eff.riders.assignMode)} assigning · PIN ${eff.riders.deliveryPin ? 'on' : 'off'} · tracking ${eff.riders.liveTracking ? 'on' : 'off'}`} onPress={go('SettingsRiders')} last />
            </Card>

            <SectionTitle section="platform">Platform</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="platform" icon="bolt" title="App version and alerts" subtitle={eff.app.minVersion ? `Minimum version ${eff.app.minVersion}` : 'No minimum version'} onPress={go('SettingsApp')} last />
            </Card>
        </Screen>
    );
}
