import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'react-native';
import { Badge, Avatar } from './ui';
import Icon from './Icon';
import { useTheme, spacing, radius, font } from '../theme';

// one colour for the state of a shop: green taking orders, amber paused by owner, red blocked / suspended
export const stateTone = (shop) => {
    if (shop.status && shop.status !== 'active') return 'danger';
    const s = shop.state;
    if (!s || s.acceptingOrders) return 'success';
    return s.reasons?.[0]?.code === 'owner_paused' ? 'warn' : 'danger';
};

// Why a shop is not taking orders, as one badge. `state` comes from the backend (shopState).
export function ShopStateBadge({ shop }) {
    if (shop.status && shop.status !== 'active') return <Badge label="Suspended" tone="danger" />;
    const s = shop.state;
    if (!s || s.acceptingOrders) return <Badge label="Taking orders" tone="success" />;
    return <Badge label={s.reasons[0].label} tone={stateTone(shop)} />;
}

// A shop in a list: coloured edge shows the state at a glance.
export function ShopRow({ shop, onPress, compact }) {
    const t = useTheme();
    const tone = stateTone(shop);
    const edge = { success: t.success, warn: t.warn, danger: t.danger }[tone];
    const billing = shop.billing?.state;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [s.row, { backgroundColor: t.surface, opacity: pressed ? 0.9 : 1 }, t.shadow]}
        >
            <View style={[s.edge, { backgroundColor: edge }]} />
            <View style={{ flex: 1, padding: spacing.md, paddingLeft: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {(shop.appIcon || shop.logo)
                        ? <Image source={{ uri: shop.appIcon || shop.logo }} resizeMode="contain" style={{ width: compact ? 38 : 46, height: compact ? 38 : 46, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
                        : <Avatar name={shop.name} size={compact ? 38 : 46} />}
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }} numberOfLines={1}>{shop.name}</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 1 }} numberOfLines={1}>{shop.slug}</Text>
                    </View>
                    <Icon name="next" size={18} color={t.muted} />
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                    <ShopStateBadge shop={shop} />
                    {shop.state?.reasons?.length > 1 ? <Badge label={`+${shop.state.reasons.length - 1} more`} /> : null}
                    {billing === 'paused' || billing === 'grace' ? <Badge label={`Rent ${billing}`} tone={billing === 'paused' ? 'danger' : 'warn'} icon="receipt" /> : null}
                </View>
            </View>
        </Pressable>
    );
}

const s = StyleSheet.create({
    row: { flexDirection: 'row', borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm },
    edge: { width: 5 },
});
