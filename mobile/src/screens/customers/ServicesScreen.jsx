// Account, Services: what this shop offers besides the menu. Tap one to read about it and send an inquiry.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchServices } from '../../api/customers/shopApi';
import { priceLine } from '../owners/OwnerServicesScreen';
import { tr } from '../../i18n';

export default function ServicesScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => { fetchServices().then((r) => { setItems(r.items || []); setErr(''); }).catch((e) => { setErr(e?.response?.data?.error || tr('Could not load')); setItems((x) => x || []); }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Services')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="briefcase-outline" title={tr('Nothing here right now')} hint={tr('This shop has not switched on any services.')} /> : null}
                {(items || []).map((s) => (
                    <Card key={s._id} onPress={() => nav.navigate('ServiceForm', { id: String(s._id) })}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: primary + '1F', marginRight: 12 }}>
                                <Ionicons name={s.icon || 'sparkles-outline'} size={23} color={primary} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16 }}>{s.name}</Text>
                                <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{priceLine(s)}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={muted} />
                        </View>
                    </Card>
                ))}
            </ScrollView>
        </View>
    );
}
