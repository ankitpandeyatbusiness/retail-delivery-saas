// Banners: the pictures at the top of the customer's home screen. Order them, switch them on or off, tap to edit.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Button, Pill, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { banners as bannersApi, reorder, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ymdOf } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerBannersScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, error } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        try { setItems((await bannersApi.list({ limit: 100 })).items || []); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your banners.')); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const move = async (i, d) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = [...items];
        [next[i], next[j]] = [next[j], next[i]];
        setItems(next);
        try { await reorder('banners', next.map((b) => String(b._id))); } catch (e) { setItems(items); showToast(apiError(e)); }
    };
    const toggle = async (b, on) => {
        setItems((xs) => xs.map((x) => (x._id === b._id ? { ...x, isActive: on } : x)));
        try { await bannersApi.update(b._id, { isActive: on }); }
        catch (e) { setItems((xs) => xs.map((x) => (x._id === b._id ? { ...x, isActive: !on } : x))); showToast(apiError(e)); }
    };
    const ended = (b) => b.endsAt && new Date(b.endsAt) < new Date();

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Banners')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 10 }}>{tr('Banners slide across the top of the home screen in this order.')}</Text>
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="images-outline" title={tr('No banners yet')} hint={tr('Add a picture for an offer or a new dish.')} /> : null}
                {(items || []).map((b, i) => (
                    <Card key={b._id} onPress={() => nav.navigate('OwnerBanner', { id: String(b._id) })} style={{ opacity: b.isActive === false ? 0.6 : 1 }}>
                        {b.image ? <Image source={{ uri: b.image }} style={{ width: '100%', height: 110, borderRadius: 12, marginBottom: 10, backgroundColor: alpha(muted, 0.15) }} contentFit="cover" /> : null}
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ marginRight: 10 }}>
                                <Pressable onPress={() => move(i, -1)} hitSlop={8} disabled={i === 0}><Ionicons name="chevron-up" size={22} color={text} style={{ opacity: i === 0 ? 0.3 : 1 }} /></Pressable>
                                <Pressable onPress={() => move(i, 1)} hitSlop={8} disabled={i === items.length - 1}><Ionicons name="chevron-down" size={22} color={text} style={{ opacity: i === items.length - 1 ? 0.3 : 1 }} /></Pressable>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '900' }} numberOfLines={1}>{b.title || tr('Banner')}</Text>
                                {b.subtitle ? <Text style={{ color: muted, fontSize: 12 }} numberOfLines={1}>{b.subtitle}</Text> : null}
                                <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                    {b.couponCode ? <Pill label={tr('Code {couponCode}', { couponCode: b.couponCode })} icon="pricetag" /> : null}
                                    {ended(b) ? <View style={{ marginLeft: 6 }}><Pill label={tr('Ended')} color={error} /></View> : null}
                                    {b.endsAt && !ended(b) ? <Text style={{ color: muted, fontSize: 12, marginLeft: 6, alignSelf: 'center' }}>{tr('until {ymdOf}', { ymdOf: ymdOf(b.endsAt) })}</Text> : null}
                                </View>
                            </View>
                            <Toggle value={b.isActive !== false} onValueChange={(on) => toggle(b, on)} />
                        </View>
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Add a banner')} icon="add" onPress={() => nav.navigate('OwnerBanner', {})} /></View>
            </ScrollView>
        </View>
    );
}
