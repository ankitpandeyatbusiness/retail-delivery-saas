// Coupons: discount codes. Switch one on or off, tap to edit, add a new one.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { coupons as couponsApi, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { couponText } from '../../utils/owners/hubRules';
import { ymdOf } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerCouponsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, error } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        try { setItems((await couponsApi.list({ limit: 100 })).items || []); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your coupons.')); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const toggle = async (c, on) => {
        setItems((xs) => xs.map((x) => (x._id === c._id ? { ...x, isActive: on } : x)));
        try { await couponsApi.update(c._id, { isActive: on }); }
        catch (e) { setItems((xs) => xs.map((x) => (x._id === c._id ? { ...x, isActive: !on } : x))); showToast(apiError(e)); }
    };
    const ended = (c) => c.endsAt && new Date(c.endsAt) < new Date();

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Coupons')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="pricetag-outline" title={tr('No coupons yet')} hint={tr('Make a code like FIRST50 and tell your customers.')} /> : null}
                {(items || []).map((c) => (
                    <Card key={c._id} onPress={() => nav.navigate('OwnerCoupon', { id: String(c._id) })} style={{ opacity: c.isActive === false ? 0.6 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 17, letterSpacing: 1 }}>{c.code}</Text>
                                <Text style={{ color: text, marginTop: 2 }}>{couponText(c)}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{tr('Used {v1}{v2} times{v3}{v4}', { v1: c.usedCount || 0, v2: c.totalUsageLimit ? ` of ${c.totalUsageLimit}` : '', v3: c.endsAt ? ` · ends ${ymdOf(c.endsAt)}` : '', v4: c.firstOrderOnly ? ' · first order only' : '' })}</Text>
                                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                                    {ended(c) ? <Pill label={tr('Ended')} color={error} /> : null}
                                    {c.isPublic === false ? <Pill label={tr('Private code')} color={muted} /> : null}
                                </View>
                            </View>
                            <Toggle value={c.isActive !== false} onValueChange={(on) => toggle(c, on)} />
                        </View>
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Add a coupon')} icon="add" onPress={() => nav.navigate('OwnerCoupon', {})} /></View>
            </ScrollView>
        </View>
    );
}
