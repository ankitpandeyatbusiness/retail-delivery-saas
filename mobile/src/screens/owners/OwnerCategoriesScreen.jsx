// Categories: the sections of the menu. Move them up and down, switch one off to hide it, tap to edit pictures and hours.
import React, { useCallback } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { useMenuStore } from '../../store/owners/useMenuStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { categories as categoriesApi, apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

// "Mon–Fri 07:00–11:00" for the first slot, "+2 more" for the rest
function hoursText(timings = []) {
    if (!timings.length) return 'All day';
    const s = timings[0];
    const days = !s.days?.length || s.days.length === 7 ? 'Every day' : s.days.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ');
    return `${days} ${s.open}–${s.close}${timings.length > 1 ? `  +${timings.length - 1} more` : ''}`;
}

export default function OwnerCategoriesScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, and the categories as numbered cards three across
    const nav = useNavigation();
    const { background, muted, text, primary, surface, border } = useBrand();
    const cats = useMenuStore((s) => s.categories);
    const loading = useMenuStore((s) => s.loading);
    const error = useMenuStore((s) => s.error);
    useFocusEffect(useCallback(() => { useMenuStore.getState().load({ quiet: true }); }, []));

    const move = async (i, d) => {
        const ids = cats.map((c) => String(c._id));
        const j = i + d;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        try { await useMenuStore.getState().saveOrder('categories', ids); } catch (e) { showToast(e.message); }
    };
    const toggle = async (c, on) => {
        useMenuStore.setState((st) => ({ categories: st.categories.map((x) => (x._id === c._id ? { ...x, isActive: on } : x)) }));
        try { await categoriesApi.update(c._id, { isActive: on }); }
        catch (e) {
            useMenuStore.setState((st) => ({ categories: st.categories.map((x) => (x._id === c._id ? { ...x, isActive: !on } : x)) }));
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Categories')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero icon="list" title={tr('Categories')} subtitle={tr('The sections of your menu. The arrows set the order customers see.')}
                        right={<HeroBtn label={tr('Add a category')} icon="add-circle" solid onPress={() => nav.navigate('OwnerCategory', {})} />}>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            <GlassStat label={tr('Categories')} value={String(cats.length)} icon="grid-outline" />
                            <GlassStat label={tr('Showing')} value={String(cats.filter((c) => c.isActive !== false).length)} icon="eye-outline" />
                            <GlassStat label={tr('Hidden')} value={String(cats.filter((c) => c.isActive === false).length)} icon="eye-off-outline" />
                            <GlassStat label={tr('Items')} value={String(cats.reduce((n, c) => n + (c.itemCount || 0), 0))} icon="restaurant-outline" />
                        </View>
                    </Hero>
                ) : null}
                {desk ? null : <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 10 }}>{tr('The arrows set the order customers see. Switch a category off to hide all its items.')}</Text>}
                {error && !cats.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={error} /> : null}
                {!loading && !error && !cats.length ? <Empty icon="list-outline" title={tr('No categories yet')} hint={tr('Add one here, or just type a new category while adding an item.')} /> : null}
                {desk ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                        {cats.map((c, i) => (
                            <View key={c._id} style={{ width: '33.333%', padding: 8 }}>
                                <Pressable onPress={() => nav.navigate('OwnerCategory', { id: String(c._id) })} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, padding: 18, opacity: c.isActive === false ? 0.65 : 1, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 18 }}>{i + 1}</Text></View>
                                        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 17 }} numberOfLines={1}>{c.name}</Text>
                                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{c.itemCount} {c.itemCount === 1 ? tr('item') : tr('items')}</Text>
                                        </View>
                                        <Toggle value={c.isActive !== false} onValueChange={(on) => toggle(c, on)} />
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                                        <Ionicons name="time-outline" size={14} color={muted} />
                                        <Text style={{ flex: 1, color: muted, fontSize: 12.5, fontWeight: '700', marginLeft: 6 }} numberOfLines={1}>{hoursText(c.timings)}</Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                                        {c.isActive === false ? <Pill label={tr('Hidden from customers')} color={muted} /> : null}
                                        <View style={{ flex: 1 }} />
                                        <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={({ hovered }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered && i > 0 ? alpha(primary, 0.14) : 'transparent', opacity: i === 0 ? 0.3 : 1, cursor: 'pointer' })}><Ionicons name="arrow-back" size={18} color={text} /></Pressable>
                                        <Pressable onPress={() => move(i, 1)} disabled={i === cats.length - 1} hitSlop={6} style={({ hovered }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered && i < cats.length - 1 ? alpha(primary, 0.14) : 'transparent', opacity: i === cats.length - 1 ? 0.3 : 1, cursor: 'pointer' })}><Ionicons name="arrow-forward" size={18} color={text} /></Pressable>
                                    </View>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                ) : null}
                {desk ? null : cats.map((c, i) => (
                    <Card key={c._id} onPress={() => nav.navigate('OwnerCategory', { id: String(c._id) })} style={{ opacity: c.isActive === false ? 0.65 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ marginRight: 10 }}>
                                <Pressable onPress={() => move(i, -1)} hitSlop={8} disabled={i === 0}><Ionicons name="chevron-up" size={22} color={i === 0 ? muted : text} style={{ opacity: i === 0 ? 0.3 : 1 }} /></Pressable>
                                <Pressable onPress={() => move(i, 1)} hitSlop={8} disabled={i === cats.length - 1}><Ionicons name="chevron-down" size={22} color={i === cats.length - 1 ? muted : text} style={{ opacity: i === cats.length - 1 ? 0.3 : 1 }} /></Pressable>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{c.name}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{c.itemCount} {c.itemCount === 1 ? tr('item') : tr('items')}  ·  {hoursText(c.timings)}</Text>
                                {c.isActive === false ? <View style={{ marginTop: 6 }}><Pill label={tr('Hidden from customers')} color={muted} /></View> : null}
                            </View>
                            <Toggle value={c.isActive !== false} onValueChange={(on) => toggle(c, on)} />
                        </View>
                    </Card>
                ))}
                {desk ? null : <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                    <Button label={tr('Add a category')} icon="add" onPress={() => nav.navigate('OwnerCategory', {})} />
                </View>}
              </Frame>
            </ScrollView>
        </View>
    );
}
