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
import { StaffHeader, Segment, FadeIn, useColumns, cellStyle } from '../../components/staff/staffBits';
import { ServeCard, RequestCard, TableCell, ServedStrip } from '../../components/staff/WaiterCards';
import TableSheet from '../../components/staff/TableSheet';
import TableBoard from '../../components/staff/TableBoard';
import OffDutyBanner from '../../components/staff/OffDutyBanner';
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
    const undoServed = async (o) => {
        try { await useWaiterStore.getState().undo(o.id); showToast(tr('Undone')); } catch (e) { showToast(apiError(e)); }
    };
    const openBill = (table, sessionId) => { if (sessionId) setOpen({ table, sessionId }); };

    const sub = w.counts.late > 0 ? tr('{n} waiting too long', { n: w.counts.late }) : shop;
    const tabs = [['serve', tr('Serve'), w.counts.serve, w.counts.late > 0], ['requests', tr('Requests'), w.counts.requests, false], ['tables', tr('Tables'), 0, false]];
    const tableRows = useMemo(() => w.tables, [w.tables]);
    const pad = (tcols - (tableRows.length % tcols)) % tcols;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={tr('Waiter')} subtitle={sub} />
            <OffDutyBanner />
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
                <FadeIn k={tab}>
                    <FlatList
                        key={`serve${cols}`}
                        numColumns={cols}
                        data={w.serve}
                        ListHeaderComponent={<ServedStrip list={w.served} busyOf={(o) => !!w.busy[`undo${o.id}`]} onUndo={(o) => undoServed(o)} />}
                        keyExtractor={(o) => o.id}
                        renderItem={({ item }) => <View style={cellStyle(cols)}><ServeCard o={item} lateMin={w.rules.serveLateMin} busy={!!w.busy[`serve${item.id}`]} onServe={() => act('serve', item.id)} /></View>}
                        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
                        showsVerticalScrollIndicator={false}
                        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                        ListEmptyComponent={<Empty icon="restaurant-outline" title={tr('Nothing to serve')} hint={tr('Dishes the kitchen finishes appear here, with a sound.')} />}
                        initialNumToRender={6}
                        windowSize={7}
                    />
                </FadeIn>
            ) : null}

            {!first && !failedFirst && tab === 'requests' ? (
                <FadeIn k={tab}>
                    <FlatList
                        key={`req${cols}`}
                        numColumns={cols}
                        data={w.requests}
                        keyExtractor={(q) => q.id}
                        renderItem={({ item }) => (
                            <View style={cellStyle(cols)}><RequestCard q={item} lateMin={w.rules.serveLateMin} busy={!!w.busy[`done${item.id}`]} onDone={() => act('done', item.id)} onOpenBill={() => openBill(item.table, item.sessionId)} /></View>
                        )}
                        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
                        showsVerticalScrollIndicator={false}
                        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                        ListEmptyComponent={<Empty icon="hand-left-outline" title={tr('No requests')} hint={tr('When a table calls you or asks for the bill, it appears here.')} />}
                    />
                </FadeIn>
            ) : null}

            {!first && !failedFirst && tab === 'tables' ? (
                <FadeIn k={tab}>
                    <ScrollView
                        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                        showsVerticalScrollIndicator={false}
                        refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                    >
                        {tableRows.length === 0 ? <Empty icon="grid-outline" title={tr('No tables')} hint={tr('Dine in is not set up yet.')} /> : <TableBoard tables={tableRows} rules={w.rules} onOpen={openBill} />}
                    </ScrollView>
                </FadeIn>
            ) : null}

            <TableSheet session={open} onClose={() => setOpen(null)} onPaid={() => { setOpen(null); useWaiterStore.getState().load(); }} />
        </View>
    );
}

