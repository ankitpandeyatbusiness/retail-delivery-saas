// Collections: strips on the customer's home screen ("Diwali gift boxes", "Combos") made of existing items.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { collections as collectionsApi, reorder, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ymdOf } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerCollectionsScreen() {
    const nav = useNavigation();
    const { background, muted, text, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const r = await collectionsApi.list({ limit: 100 });
            setItems(r.items || []);
            setError('');
        } catch (e) { useOwnerStore.getState().noteError(e); setError(apiError(e, 'Could not load the collections.')); setItems((x) => x || []); }
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
                <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 10 }}>{tr('A collection is a strip on the home screen made from items you already have. Use it for festivals and combos.')}</Text>
                {items === null ? <ListShimmer /> : null}
                {error && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={error} /> : null}
                {items && !error && !items.length ? <Empty icon="albums-outline" title={tr('No collections yet')} hint={tr('Add one, for example \'Diwali gift boxes\'.')} /> : null}
                {(items || []).map((c, i) => (
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
                <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                    <Button label={tr('Add a collection')} icon="add" onPress={() => nav.navigate('OwnerCollection', {})} />
                </View>
            </ScrollView>
        </View>
    );
}
