// Account, Services: what this shop offers besides the menu (tiffin, party booking and the owner's own services). Each one is a picture card:
// its first photo, or the shop's own colours with a big icon when it has none. Tap one to read about it and send an inquiry.
// (Bulk orders have their own rows on the Account screen and their own screens.)
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Empty, Button } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import ServiceHeroCard from '../../components/customers/ServiceHeroCard';
import { fetchServices } from '../../api/customers/shopApi';
import { priceLine } from '../owners/OwnerServicesScreen';
import { tr } from '../../i18n';
import DeskGrid from '../../components/common/DeskGrid';

export default function ServicesScreen() {
    const nav = useNavigation();
    const { background } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => { fetchServices().then((r) => { setItems(r.items || []); setErr(''); }).catch((e) => { setErr(e?.response?.data?.error || tr('Could not load')); setItems((x) => x || []); }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Services')} />
            <ScrollView contentContainerStyle={{ paddingTop: 10, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                {items && items.length ? <View style={{ paddingHorizontal: 16, marginBottom: 10 }}><Button label={tr('My inquiries')} icon="chatbubbles-outline" kind="ghost" onPress={() => nav.navigate('MyInquiries')} /></View> : null}
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="briefcase-outline" title={tr('Nothing here right now')} hint={tr('This shop has not switched on any services.')} /> : null}
                <DeskGrid>
                    {(items || []).map((s) => <ServiceHeroCard key={s._id} service={s} priceText={priceLine(s)} onPress={() => nav.navigate('ServiceForm', { id: String(s._id) })} />)}
                </DeskGrid>
            </ScrollView>
        </View>
    );
}
