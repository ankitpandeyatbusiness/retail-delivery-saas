import React from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import RecordList from '../../components/RecordList';
import { Card, Badge, IconTile } from '../../components/ui';
import { useTheme, spacing, font } from '../../theme';
import { dateOnly, rupees } from '../../utils/format';

export const couponValue = (c) => (c.discountType === 'percent' ? `${c.discountValue}% off` : `${rupees(c.discountValue)} off`);

export default function CouponsScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    return (
        <RecordList
            shopId={shopId}
            shopName={name}
            resource="coupons"
            title="Coupons"
            formScreen="CouponForm"
            searchPlaceholder="Search by code"
            emptyTitle="No coupons yet"
            emptyHint="Coupons give customers a discount at checkout."
            renderRow={(c, { open }) => (
                <Card onPress={open} style={{ marginBottom: spacing.sm, opacity: c.isActive === false ? 0.55 : 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <IconTile icon="coupon" section="money" />
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg, letterSpacing: 0.5 }}>{c.code}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>
                                {couponValue(c)}{c.minOrder ? `  ·  min ${rupees(c.minOrder)}` : ''}
                            </Text>
                        </View>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
                        <Badge label={`Used ${c.usedCount || 0}${c.totalUsageLimit ? ` / ${c.totalUsageLimit}` : ''}`} />
                        {c.isPublic === false ? <Badge label="Hidden code" tone="info" /> : <Badge label="Shown to customers" tone="success" />}
                        {c.firstOrderOnly ? <Badge label="First order only" tone="info" /> : null}
                        {c.endsAt ? <Badge label={`Until ${dateOnly(c.endsAt)}`} /> : null}
                        {c.isActive === false ? <Badge label="Switched off" tone="danger" /> : null}
                    </View>
                </Card>
            )}
        />
    );
}
