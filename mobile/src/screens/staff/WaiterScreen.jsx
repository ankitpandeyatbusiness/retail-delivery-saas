// The waiter's screen. Three views: "Serve" (dishes the kitchen finished, oldest first), "Requests" (a table calls, or wants the bill) and
// "Tables" (who is eating, who owes what; tap a table for its bill). Things arrive by themselves with a sound, and the screen stays awake.
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useBrand, alpha } from '../../components/common/kit';
import { Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { StaffHeader, Segment, useColumns, cellStyle } from '../../components/staff/staffBits';
import { ServeCard, RequestCard, TableCell } from '../../components/staff/WaiterCards';
import TableSheet from '../../components/staff/TableSheet';
import { useWaiterStore } from '../../store/staff/useWaiterStore';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function WaiterScreen() {
    const { background, text, warn, primary, muted } = useBrand();
    const shop = useStaffStore((s) => s.me?.shop);
    const w = useWaiterStore();
    const [tab, setTab] = useState('serve');
    const [open, setOpen] = useState(null);   // the table whose bill is open: { table, sessionId }
    const [pulling, setPulling] = useState(false);
    const cols = useColumns();
    const tcols = cols === 1 ? 3 : cols === 2 ? 5 : 7;   // table cells per row

    // the phone stays awake while the waiter's screen is on the front
    useFocusEffect(useCallback(() => { activateKeepAwakeAsync('waiter').catch(() => { }); return () => { deactivateKeepAwake('waiter').catch(() => { }); }; }, []));

    const first = w.state === 'loading' || (!w.loadedAt && w.state !== 'error');
    const failedFirst = w.state === 'error' && !w.loadedAt;
    const act = useCallback(async (kind, id) => {
        try {
            const r = await useWaiterStore.getState().act(kind, id);
            if (r?.already) showToast(kind === 'serve' ? tr('Already served {ago}', { ago: r.ago || '' }) : tr('Someone already did this'));
        } catch (e) { showToast(apiError(e)); }
    }, []);
    const refresh = async () => { setPulling(true); await useWaiterStore.getState().load(); setPulling(false); };
    const openBill = (table, sessionId) => { if (sessionId) setOpen({ table, sessionId }); };

    const sub = w.counts.late > 0 ? tr('{n} waiting too long', { n: w.counts.late }) : shop;
    const tabs = [['serve', tr('Serve'), w.counts.serve, w.counts.late > 0], ['requests', tr('Requests'), w.counts.requests, false], ['tables', tr('Tables'), 0, false]];
    const tableRows = useMemo(() => w.tables, [w.tables]);
    const pad = (tcols - (tableRows.length % tcols)) % tcols;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={tr('Floor')} subtitle={sub} right={<Live live={w.state === 'ok'} />} />
            <Segment value={tab} onChange={setTab} tabs={tabs} />
            {w.state === 'error' && w.loadedAt ? (
                <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: alpha(warn, 0.16), flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="cloud-offline-outline" size={18} color={warn} style={{ marginRight: 8 }} />
                    <Text style={{ color: text, fontWeight: '700', flex: 1, fontSize: 13 }}>{tr('No connection. This list may be old.')}</Text>
                    <Pressable onPress={refresh} hitSlop={8}><Text style={{ color: primary, fontWeight: '900' }}>{tr('Try again')}</Text></Pressable>
                </View>
            ) : null}
            {first ? <ListShimmer /> : null}
            {failedFirst ? (
                <View>
                    <Empty icon="cloud-offline-outline" title={tr('Could not load the floor')} hint={tr('Check your internet.')} />
                    <Pressable onPress={refresh} style={{ alignSelf: 'center', padding: 12 }}><Text style={{ color: primary, fontWeight: '900' }}>{tr('Try again')}</Text></Pressable>
                </View>
            ) : null}

            {!first && !failedFirst && tab === 'serve' ? (
                <FlatList
                    key={`serve${cols}`}
                    numColumns={cols}
                    data={w.serve}
                    keyExtractor={(o) => o.id}
                    renderItem={({ item }) => <View style={cellStyle(cols)}><ServeCard o={item} lateMin={w.rules.serveLateMin} busy={!!w.busy[`serve${item.id}`]} onServe={() => act('serve', item.id)} /></View>}
                    contentContainerStyle={{ paddingBottom: 130, flexGrow: 1 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                    ListEmptyComponent={<Empty icon="restaurant-outline" title={tr('Nothing to serve')} hint={tr('Dishes the kitchen finishes appear here, with a sound.')} />}
                    initialNumToRender={6}
                    windowSize={7}
                />
            ) : null}

            {!first && !failedFirst && tab === 'requests' ? (
                <FlatList
                    key={`req${cols}`}
                    numColumns={cols}
                    data={w.requests}
                    keyExtractor={(q) => q.id}
                    renderItem={({ item }) => (
                        <View style={cellStyle(cols)}><RequestCard q={item} lateMin={w.rules.serveLateMin} busy={!!w.busy[`done${item.id}`]} onDone={() => act('done', item.id)} onOpenBill={() => openBill(item.table, item.sessionId)} /></View>
                    )}
                    contentContainerStyle={{ paddingBottom: 130, flexGrow: 1 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                    ListEmptyComponent={<Empty icon="hand-left-outline" title={tr('No requests')} hint={tr('When a table calls you or asks for the bill, it appears here.')} />}
                />
            ) : null}

            {!first && !failedFirst && tab === 'tables' ? (
                <ScrollView
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                >
                    {tableRows.length === 0 ? <Empty icon="grid-outline" title={tr('No tables')} hint={tr('Dine in is not set up yet.')} /> : null}
                    <Text style={{ color: muted, fontSize: 12.5, marginBottom: 10 }}>{tr('Tap a table that is in use to see its bill.')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                        {tableRows.map((t) => <TableCell key={t.table} t={t} cols={tcols} onPress={() => openBill(t.table, t.sessionId)} />)}
                        {Array.from({ length: pad }).map((_, i) => <View key={`pad${i}`} style={{ width: `${(100 - (tcols - 1) * 2) / tcols}%` }} />)}
                    </View>
                </ScrollView>
            ) : null}

            <TableSheet session={open} onClose={() => setOpen(null)} onPaid={() => { setOpen(null); useWaiterStore.getState().load(); }} />
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
