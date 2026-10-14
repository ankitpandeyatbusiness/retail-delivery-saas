import React from 'react';
import { View, Text, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import RecordList from '../../components/RecordList';
import { Card, Badge } from '../../components/ui';
import Icon from '../../components/Icon';
import { useTheme, spacing, font, radius } from '../../theme';
import { dateOnly } from '../../utils/format';

export default function BannersScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    return (
        <RecordList
            shopId={shopId}
            shopName={name}
            resource="banners"
            title="Banners"
            formScreen="BannerForm"
            searchPlaceholder="Search banners"
            emptyTitle="No banners yet"
            emptyHint="Banners are the offer cards at the top of the customer's home screen."
            renderRow={(b, { open }) => (
                <Card onPress={open} padded={false} style={{ marginBottom: spacing.md, overflow: 'hidden', opacity: b.isActive === false ? 0.55 : 1 }}>
                    {b.image
                        ? <Image source={{ uri: b.image }} style={{ height: 120, width: '100%', backgroundColor: t.surfaceAlt }} resizeMode="cover" />
                        : <View style={{ height: 80, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon name="banner" size={28} color={t.muted} /></View>}
                    <View style={{ padding: spacing.md }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{b.title || 'Untitled banner'}</Text>
                        {b.subtitle ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{b.subtitle}</Text> : null}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            {b.couponCode ? <Badge label={`Code ${b.couponCode}`} tone="primary" icon="coupon" /> : null}
                            {b.firstOrderOnly ? <Badge label="First order only" tone="info" /> : null}
                            {b.startsAt || b.endsAt ? <Badge label={`${b.startsAt ? dateOnly(b.startsAt) : '…'} – ${b.endsAt ? dateOnly(b.endsAt) : '…'}`} /> : null}
                            {b.isActive === false ? <Badge label="Switched off" tone="danger" /> : null}
                        </View>
                    </View>
                </Card>
            )}
        />
    );
}
