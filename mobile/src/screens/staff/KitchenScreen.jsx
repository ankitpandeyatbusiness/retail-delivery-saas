// The cook's screen. Two lists: "To make" (oldest first; new ones wait for Start cooking, cooking ones for Ready) and "Ready" (waiting for the
// waiter, the rider or the customer). New orders arrive by themselves with a chime; the screen stays awake while it is open.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useBrand, alpha } from '../../components/common/kit';
import { Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { StaffHeader, Segment } from '../../components/staff/staffBits';
import KitchenOrderCard from '../../components/staff/KitchenOrderCard';
import ProblemSheet from '../../components/staff/ProblemSheet';
import { useKitchenStore } from '../../store/staff/useKitchenStore';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function KitchenScreen() {
    const { background, text, warn, primary } = useBrand();
    const shop = useStaffStore((s) => s.me?.shop);
    const items = useKitchenStore((s) => s.items);
    const counts = useKitchenStore((s) => s.counts);
    const rules = useKitchenStore((s) => s.rules);
    const state = useKitchenStore((s) => s.state);
    const busy = useKitchenStore((s) => s.busy);
    const loadedAt = useKitchenStore((s) => s.loadedAt);
    const [tab, setTab] = useState('make');
    const [problem, setProblem] = useState(null);
    const [pulling, setPulling] = useState(false);

    // the phone stays awake while the kitchen screen is on the front
    useFocusEffect(useCallback(() => { activateKeepAwakeAsync('kitchen').catch(() => { }); return () => { deactivateKeepAwake('kitchen').catch(() => { }); }; }, []));

    const make = useMemo(() => items.filter((o) => o.stage !== 'ready'), [items]);
    const done = useMemo(() => items.filter((o) => o.stage === 'ready'), [items]);
    const list = tab === 'make' ? make : done;

    const act = useCallback(async (o, kind) => {
        try {
            const r = await useKitchenStore.getState().act(o.id, kind);
            if (r?.already) showToast(r.by ? tr('{name} already did this {ago}', { name: r.by, ago: r.ago || '' }) : tr('Someone already did this'));
        } catch (e) { showToast(apiError(e)); }
    }, []);

    const refresh = async () => { setPulling(true); await useKitchenStore.getState().load(); setPulling(false); };
    const first = state === 'loading' || (!loadedAt && state !== 'error');

    const sub = counts.late > 0 ? tr('{n} late', { n: counts.late }) : shop;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={tr('Kitchen')} subtitle={sub} right={<Live live={state === 'ok'} />} />
            <Segment value={tab} onChange={setTab} tabs={[['make', tr('To make'), counts.new + counts.cooking, counts.late > 0], ['ready', tr('Ready'), counts.ready, false]]} />
            {state === 'error' && loadedAt ? (
                <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: alpha(warn, 0.16), flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="cloud-offline-outline" size={18} color={warn} style={{ marginRight: 8 }} />
                    <Text style={{ color: text, fontWeight: '700', flex: 1, fontSize: 13 }}>{tr('No connection. This list may be old.')}</Text>
                    <Pressable onPress={refresh} hitSlop={8}><Text style={{ color: primary, fontWeight: '900' }}>{tr('Try again')}</Text></Pressable>
                </View>
            ) : null}
            {first ? <ListShimmer /> : null}
            {state === 'error' && !loadedAt ? (
                <View>
                    <Empty icon="cloud-offline-outline" title={tr('Could not load the orders')} hint={tr('Check your internet.')} />
                    <Pressable onPress={refresh} style={{ alignSelf: 'center', padding: 12 }}><Text style={{ color: primary, fontWeight: '900' }}>{tr('Try again')}</Text></Pressable>
                </View>
            ) : null}
            {!first && !(state === 'error' && !loadedAt) ? (
                <FlatList
                    data={list}
                    keyExtractor={(o) => o.id}
                    renderItem={({ item }) => (
                        <KitchenOrderCard o={item} lateMin={rules.lateMin || 20} busy={!!busy[item.id]} onAct={(k) => act(item, k)} onProblem={() => setProblem(item)} />
                    )}
                    contentContainerStyle={{ paddingBottom: 130, flexGrow: 1 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                    ListEmptyComponent={tab === 'make'
                        ? <Empty icon="restaurant-outline" title={tr('Nothing to make')} hint={tr('New orders appear here by themselves, with a sound.')} />
                        : <Empty icon="checkmark-done-outline" title={tr('Nothing waiting')} hint={tr('Orders you mark Ready stay here for an hour.')} />}
                    initialNumToRender={6}
                    windowSize={7}
                />
            ) : null}
            <ProblemSheet order={problem} onClose={() => setProblem(null)} onDone={() => { setProblem(null); useKitchenStore.getState().load(); }} />
        </View>
    );
}

// a small dot: live (green) or no connection (grey)
function Live({ live }) {
    const { muted, ok } = useBrand();
    const c = live ? ok : muted;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c, marginRight: 6 }} />
            <Text style={{ color: c, fontWeight: '800', fontSize: 12.5 }}>{live ? tr('Live') : tr('Offline')}</Text>
        </View>
    );
}
