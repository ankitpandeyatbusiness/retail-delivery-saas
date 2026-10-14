import React from 'react';
import { View, Text, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import RecordList from '../../components/RecordList';
import { Card, Badge } from '../../components/ui';
import Icon from '../../components/Icon';
import { useTheme, spacing, font, radius } from '../../theme';
import { dateOnly } from '../../utils/format';

export default function CollectionsScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    return (
        <RecordList
            shopId={shopId}
            shopName={name}
            resource="collections"
            title="Collections"
            formScreen="CollectionForm"
            searchPlaceholder="Search collections"
            emptyTitle="No collections yet"
            emptyHint="A collection is a strip on the home screen: festival specials or combo deals made of existing items."
            renderRow={(c, { open }) => (
                <Card onPress={open} style={{ marginBottom: spacing.sm, opacity: c.isActive === false ? 0.55 : 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {c.image
                            ? <Image source={{ uri: c.image }} style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
                            : <View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon name="sparkle" size={24} color={t.muted} /></View>}
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{c.title}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                                {(c.productIds || []).length} item{(c.productIds || []).length === 1 ? '' : 's'}
                                {c.startsAt || c.endsAt ? `  ·  ${c.startsAt ? dateOnly(c.startsAt) : '…'} to ${c.endsAt ? dateOnly(c.endsAt) : '…'}` : ''}
                            </Text>
                            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                                <Badge label={c.kind === 'combo' ? 'Combo' : 'Festival'} tone={c.kind === 'combo' ? 'info' : 'warn'} />
                                {c.isActive === false ? <Badge label="Switched off" tone="danger" /> : null}
                            </View>
                        </View>
                    </View>
                </Card>
            )}
        />
    );
}
