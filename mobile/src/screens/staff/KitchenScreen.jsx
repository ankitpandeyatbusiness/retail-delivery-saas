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
import { StaffHeader } from '../../components/staff/staffBits';
import KitchenOrderCard from '../../components/staff/KitchenOrderCard';
import ProblemSheet from '../../components/staff/ProblemSheet';
import { useKitchenStore } from '../../store/staff/useKitchenStore';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

function Segment({ value, onChange, tabs }) {
    const { primary, onPrimary, surface, border, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 3, borderRadius: 14, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
            {tabs.map(([id, label, n, hot]) => {
                const on = id === value;
                return (
                    <Pressable key={id} onPress={() => onChange(id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', backgroundColor: on ? primary : 'transparent' }}>
                        <Text style={{ color: on ? onPrimary : muted, fontWeight: '900', fontSize: 14 }}>{label}</Text>
                        {n > 0 ? (
                            <View style={{ marginLeft: 6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.22) : alpha(hot ? '#E5484D' : primary, 0.18) }}>
                                <Text style={{ color: on ? onPrimary : (hot ? '#E5484D' : primary), fontWeight: '900', fontSize: 12 }}>{n}</Text>
                            </View>
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}

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
