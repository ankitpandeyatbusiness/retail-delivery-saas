// Collections: strips on the customer's home screen ("Diwali gift boxes", "Combos") made of existing items.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { collections as collectionsApi, reorder, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ymdOf } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerCollectionsScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, and the strips as cards
    const gcols = useGridCols(3, 320);
    const nav = useNavigation();
    const { background, muted, text, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const r = await collectionsApi.list({ limit: 100 });
            setItems(r.items || []);
            setError('');
        } catch (e) { useOwnerStore.getState().noteError(e); setError(apiError(e, tr('Could not load the collections.'))); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const move = async (i, d) => {
        const j = i + d;
        if (j < 0 || j >= items.length) return;
        const next = [...items];
        [next[i], next[j]] = [next[j], next[i]];
        setItems(next);
        try { await reorder('collections', next.map((c) => String(c._id))); } catch (e) { setItems(items); showToast(apiError(e)); }
    };
    const toggle = async (c, on) => {
        setItems((xs) => xs.map((x) => (x._id === c._id ? { ...x, isActive: on } : x)));
        try { await collectionsApi.update(c._id, { isActive: on }); }
        catch (e) { setItems((xs) => xs.map((x) => (x._id === c._id ? { ...x, isActive: !on } : x))); showToast(apiError(e)); }
    };

    const when = (c) => (c.startsAt || c.endsAt ? `${c.startsAt ? ymdOf(c.startsAt) : 'now'} → ${c.endsAt ? ymdOf(c.endsAt) : 'no end'}` : 'Always');

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Collections')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero compact icon="albums" title={tr('Collections')} subtitle={tr('A strip on the home screen made from items you already have: festivals, combos.')}
                        right={<HeroBtn compact label={tr('Add a collection')} icon="add-circle" solid onPress={() => nav.navigate('OwnerCollection', {})} />}>
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <GlassStat compact label={tr('Collections')} value={items ? String(items.length) : '–'} icon="albums-outline" />
                            <GlassStat compact label={tr('Showing')} value={items ? String(items.filter((c) => c.isActive !== false).length) : '–'} icon="eye-outline" />
                        </View>
                    </Hero>
                ) : null}
                {desk ? null : <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 10 }}>{tr('A collection is a strip on the home screen made from items you already have. Use it for festivals and combos.')}</Text>}
                {items === null ? <ListShimmer /> : null}
                {error && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={error} /> : null}
                {items && !error && !items.length ? <Empty icon="albums-outline" title={tr('No collections yet')} hint={tr('Add one, for example \'Diwali gift boxes\'.')} /> : null}
                {desk ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                        {(items || []).map((c, i) => (
                            <View key={c._id} style={{ width: `${100 / gcols}%`, padding: 8 }}>
                                <Pressable onPress={() => nav.navigate('OwnerCollection', { id: String(c._id) })} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : alpha(muted, 0.25), backgroundColor: hovered ? alpha(primary, 0.05) : 'transparent', padding: 18, opacity: c.isActive === false ? 0.65 : 1, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 18 }}>{i + 1}</Text></View>
                                        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 17 }} numberOfLines={1}>{c.title}</Text>
                                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('{length} items · {when}', { length: (c.productIds || []).length, when: when(c) })}</Text>
                                        </View>
                                        <Toggle value={c.isActive !== false} onValueChange={(on) => toggle(c, on)} />
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                                        <Pill label={c.kind === 'combo' ? tr('Combo') : tr('Festival')} />
                                        <View style={{ flex: 1 }} />
                                        <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={({ hovered }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered && i > 0 ? alpha(primary, 0.14) : 'transparent', opacity: i === 0 ? 0.3 : 1, cursor: 'pointer' })}><Ionicons name="arrow-back" size={18} color={text} /></Pressable>
                                        <Pressable onPress={() => move(i, 1)} disabled={i === items.length - 1} hitSlop={6} style={({ hovered }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered && i < items.length - 1 ? alpha(primary, 0.14) : 'transparent', opacity: i === items.length - 1 ? 0.3 : 1, cursor: 'pointer' })}><Ionicons name="arrow-forward" size={18} color={text} /></Pressable>
                                    </View>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                ) : null}
                {desk ? null : (items || []).map((c, i) => (
                    <Card key={c._id} onPress={() => nav.navigate('OwnerCollection', { id: String(c._id) })} style={{ opacity: c.isActive === false ? 0.65 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ marginRight: 10 }}>
                                <Pressable onPress={() => move(i, -1)} hitSlop={8} disabled={i === 0}><Ionicons name="chevron-up" size={22} color={text} style={{ opacity: i === 0 ? 0.3 : 1 }} /></Pressable>
                                <Pressable onPress={() => move(i, 1)} hitSlop={8} disabled={i === items.length - 1}><Ionicons name="chevron-down" size={22} color={text} style={{ opacity: i === items.length - 1 ? 0.3 : 1 }} /></Pressable>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{c.title}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('{length} items · {when}', { length: (c.productIds || []).length, when: when(c) })}</Text>
                                <View style={{ marginTop: 6 }}><Pill label={c.kind === 'combo' ? tr('Combo') : tr('Festival')} /></View>
                            </View>
                            <Toggle value={c.isActive !== false} onValueChange={(on) => toggle(c, on)} />
                        </View>
                    </Card>
                ))}
                {desk ? null : <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                    <Button label={tr('Add a collection')} icon="add" onPress={() => nav.navigate('OwnerCollection', {})} />
                </View>}
              </Frame>
            </ScrollView>
        </View>
    );
}
