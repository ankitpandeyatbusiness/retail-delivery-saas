// Coupons: discount codes. Switch one on or off, tap to edit, add a new one.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
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
    const desk = useOwnerDesktop();   // a computer: a banner, and the coupons as tickets three across
    const nav = useNavigation();
    const { background, text, muted, primary, error, surface, border } = useBrand();
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
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero icon="pricetag" title={tr('Coupons')} subtitle={tr('Discount codes your customers type at checkout, or pick in the app.')}
                        right={<HeroBtn label={tr('Add a coupon')} icon="add-circle" solid onPress={() => nav.navigate('OwnerCoupon', {})} />}>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            <GlassStat label={tr('Switched on')} value={items ? String(items.filter((c) => c.isActive !== false && !ended(c)).length) : '–'} icon="flash-outline" />
                            <GlassStat label={tr('Private codes')} value={items ? String(items.filter((c) => c.isPublic === false).length) : '–'} icon="eye-off-outline" />
                            <GlassStat label={tr('Ended')} value={items ? String(items.filter(ended).length) : '–'} icon="time-outline" />
                            <GlassStat label={tr('Times used')} value={items ? String(items.reduce((n, c) => n + (c.usedCount || 0), 0)) : '–'} icon="receipt-outline" />
                        </View>
                    </Hero>
                ) : null}
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="pricetag-outline" title={tr('No coupons yet')} hint={tr('Make a code like FIRST50 and tell your customers.')} /> : null}
                {desk ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                        {(items || []).map((c) => (
                            <View key={c._id} style={{ width: '33.333%', padding: 8 }}>
                                <Pressable onPress={() => nav.navigate('OwnerCoupon', { id: String(c._id) })} style={({ hovered }) => ({ flexDirection: 'row', borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, overflow: 'hidden', opacity: c.isActive === false || ended(c) ? 0.6 : 1, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                                    <View style={{ width: 104, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(primary, 0.14), paddingVertical: 18 }}>
                                        <Text style={{ color: primary, fontWeight: '900', fontSize: 28, letterSpacing: -0.8 }}>{c.discountType === 'percent' ? `${c.discountValue}%` : `₹${c.discountValue}`}</Text>
                                        <Text style={{ color: primary, fontWeight: '900', fontSize: 12, letterSpacing: 1.5 }}>{tr('OFF')}</Text>
                                    </View>
                                    <View style={{ width: 0, borderLeftWidth: 2, borderLeftColor: alpha(muted, 0.35), borderStyle: 'dashed' }} />
                                    <View style={{ flex: 1, minWidth: 0, padding: 14 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 18, letterSpacing: 2 }} numberOfLines={1}>{c.code}</Text>
                                            <Toggle value={c.isActive !== false} onValueChange={(on) => toggle(c, on)} />
                                        </View>
                                        <Text style={{ color: text, marginTop: 4, fontSize: 13.5 }} numberOfLines={2}>{couponText(c)}</Text>
                                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('Used {v1}{v2} times', { v1: c.usedCount || 0, v2: c.totalUsageLimit ? ` of ${c.totalUsageLimit}` : '' })}</Text>
                                        <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                            {ended(c) ? <View style={{ marginRight: 6 }}><Pill label={tr('Ended')} color={error} /></View> : null}
                                            {c.isPublic === false ? <Pill label={tr('Private code')} color={muted} /> : null}
                                        </View>
                                    </View>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                ) : null}
                {desk ? null : (items || []).map((c) => (
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
                {desk ? null : <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label={tr('Add a coupon')} icon="add" onPress={() => nav.navigate('OwnerCoupon', {})} /></View>}
              </Frame>
            </ScrollView>
        </View>
    );
}
