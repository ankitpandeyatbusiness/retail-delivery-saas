// Banners: the pictures at the top of the customer's home screen. Order them, switch them on or off, tap to edit.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import { PageHeader, Card, Button, Pill, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { banners as bannersApi, reorder, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ymdOf } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerBannersScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, and the pictures as cards
    const gcols = useGridCols(3, 320);
    const nav = useNavigation();
    const { background, text, muted, primary, error, surface, border } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        try { setItems((await bannersApi.list({ limit: 100 })).items || []); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, tr('Could not load your banners.'))); setItems((x) => x || []); }
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
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero compact icon="images" title={tr('Banners')} subtitle={tr('Banners slide across the top of the home screen in this order.')}
                        right={<HeroBtn compact label={tr('Add a banner')} icon="add-circle" solid onPress={() => nav.navigate('OwnerBanner', {})} />}>
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <GlassStat compact label={tr('Banners')} value={items ? String(items.length) : '–'} icon="images-outline" />
                            <GlassStat compact label={tr('Showing')} value={items ? String(items.filter((b) => b.isActive !== false && !ended(b)).length) : '–'} icon="eye-outline" />
                            <GlassStat compact label={tr('Ended')} value={items ? String(items.filter(ended).length) : '–'} icon="time-outline" />
                        </View>
                    </Hero>
                ) : null}
                {desk ? null : <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 10 }}>{tr('Banners slide across the top of the home screen in this order.')}</Text>}
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="images-outline" title={tr('No banners yet')} hint={tr('Add a picture for an offer or a new dish.')} /> : null}
                {desk ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                        {(items || []).map((b, i) => (
                            <View key={b._id} style={{ width: `${100 / gcols}%`, padding: 8 }}>
                                <Pressable onPress={() => nav.navigate('OwnerBanner', { id: String(b._id) })} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: surface, overflow: 'hidden', opacity: b.isActive === false ? 0.6 : 1, cursor: 'pointer', boxShadow: hovered ? `0 0 0 3px ${alpha(primary, 0.18)}` : '0 0 0 0 transparent', transitionProperty: 'box-shadow, border-color', transitionDuration: '150ms' })}>
                                    <View style={{ aspectRatio: 16 / 7, backgroundColor: alpha(muted, 0.15) }}>
                                        {b.image ? <Image source={{ uri: b.image }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} contentFit="cover" /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="image-outline" size={34} color={alpha(muted, 0.6)} /></View>}
                                        <View style={{ position: 'absolute', left: 10, top: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '900' }}>{i + 1}</Text></View>
                                    </View>
                                    <View style={{ padding: 14 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{b.title || tr('Banner')}</Text>
                                                {b.subtitle ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }} numberOfLines={1}>{b.subtitle}</Text> : null}
                                            </View>
                                            <Toggle value={b.isActive !== false} onValueChange={(on) => toggle(b, on)} />
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                                            {b.couponCode ? <View style={{ marginRight: 6 }}><Pill label={tr('Code {couponCode}', { couponCode: b.couponCode })} icon="pricetag" /></View> : null}
                                            {ended(b) ? <Pill label={tr('Ended')} color={error} /> : null}
                                            {b.endsAt && !ended(b) ? <Text style={{ color: muted, fontSize: 12, alignSelf: 'center' }}>{tr('until {ymdOf}', { ymdOf: ymdOf(b.endsAt) })}</Text> : null}
                                            <View style={{ flex: 1 }} />
                                            <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={({ hovered }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered && i > 0 ? alpha(primary, 0.14) : 'transparent', opacity: i === 0 ? 0.3 : 1, cursor: 'pointer' })}><Ionicons name="arrow-back" size={18} color={text} /></Pressable>
                                            <Pressable onPress={() => move(i, 1)} disabled={i === items.length - 1} hitSlop={6} style={({ hovered }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered && i < items.length - 1 ? alpha(primary, 0.14) : 'transparent', opacity: i === items.length - 1 ? 0.3 : 1, cursor: 'pointer' })}><Ionicons name="arrow-forward" size={18} color={text} /></Pressable>
                                        </View>
                                    </View>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                ) : null}
                {desk ? null : (items || []).map((b, i) => (
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
                {desk ? null : <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Add a banner')} icon="add" onPress={() => nav.navigate('OwnerBanner', {})} /></View>}
              </Frame>
            </ScrollView>
        </View>
    );
}
