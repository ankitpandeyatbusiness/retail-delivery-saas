// Activity log: who changed what in the shop, and when. Helps when something looks different and nobody knows why.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Chips, Empty, Pill } from '../../components/owners/ui';
import { fetchActivity, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { activityLabel, ACTOR_FILTERS } from '../../utils/owners/settingsRules';
import { dayTime } from '../../utils/owners/orderFlow';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerActivityScreen() {
    const { background, text, muted, primary, error } = useBrand();
    const [actor, setActor] = useState('');
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    const load = useCallback(async (p = 1) => {
        try {
            const r = await fetchActivity({ page: p, limit: 30, ...(actor ? { actorType: actor } : {}) });
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load the activity log.')); setItems((x) => x || []); }
    }, [actor]);
    useEffect(() => { setItems(null); load(1); }, [load]);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Activity log')} />
            <FlatList
                data={items || []}
                keyExtractor={(a, i) => String(a._id || i)}
                contentContainerStyle={{ paddingBottom: 60 }}
                ListHeaderComponent={<View style={{ paddingHorizontal: 16 }}><Chips options={ACTOR_FILTERS} value={actor} onChange={setActor} style={{ marginTop: 0 }} /></View>}
                renderItem={({ item: a }) => (
                    <View style={{ paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{activityLabel(a.action)}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{a.actorLabel || a.actorType} · {dayTime(a.at)}</Text>
                        </View>
                        {a.status >= 400 ? <Pill label={tr('Failed')} color={error} /> : null}
                    </View>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 0.5, backgroundColor: muted + '33', marginLeft: 16 }} />}
                ListEmptyComponent={items === null ? <ListShimmer /> : err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <Empty icon="list-outline" title={tr('Nothing yet')} hint={tr('Changes made in your shop are listed here.')} />}
                ListFooterComponent={more ? <Pressable onPress={() => load(page + 1)} style={{ padding: 18, alignItems: 'center' }}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Show more')}</Text></Pressable> : null}
            />
        </View>
    );
}
