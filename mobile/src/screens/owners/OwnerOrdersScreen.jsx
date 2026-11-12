// Orders: the live board. Chips for each stage (with counts), search by order number, and the orders as cards with
// Accept / Reject and the next step right on them. It refreshes by itself when an order changes anywhere.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, RefreshControl, LayoutAnimation } from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Empty, Field, Card, Pill, money } from '../../components/owners/ui';
import { useBulkAwaiting } from '../../hooks/owners/useBulkAwaiting';
import { OrderCard, useOrderActions } from '../../components/owners/orderBits';
import { useOrdersStore } from '../../store/owners/useOrdersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onOrderUpdate } from '../../api/common/socket';
import { BOARD_FILTERS, boardStatus } from '../../utils/owners/orderFlow';
import { useOwnerDesktop } from '../../utils/common/layout';
import { ListShimmer } from '../../components/owners/shimmer';
import { DebtCard, DebtSheet, RemindAll, useDebts } from '../../components/owners/UnpaidBills';
import { tr } from '../../i18n';

// the owner's desktop board: one column per stage of a live order, and the finished ones as a grid under their own tabs
const BOARD_COLS = [['placed', 'New', 'alert-circle'], ['accepted', 'Accepted', 'checkmark-circle'], ['preparing', 'Preparing', 'flame'], ['ready', 'Ready', 'bag-check'], ['out_for_delivery', 'On the road', 'bicycle']];
const BOARD_TABS = [['active', 'Live board'], ['table', 'On the table'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['history', 'History']];

function DeskTab({ label, count, on, urgent, onPress }) {
    const { primary, onPrimary, text, border, error } = useBrand();
    return (
        <Pressable onPress={onPress} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 42, borderRadius: 21, marginRight: 8, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : hovered ? border : 'transparent', cursor: 'pointer' })}>
            <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
            {count > 0 ? <View style={{ marginLeft: 8, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.25) : (urgent ? error : primary) }}><Text style={{ fontSize: 12, fontWeight: '900', color: on || urgent ? '#FFFFFF' : onPrimary }}>{count > 99 ? '99+' : count}</Text></View> : null}
        </Pressable>
    );
}

const ACTIVE_STAGES = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

// On the "Active" chip the orders nobody has accepted come first, oldest first (they are the ones that expire);
// everything else keeps the server's order, newest first.
function arrange(items, filter) {
    if (filter !== 'active' && filter !== 'placed') return items;
    const fresh = items.filter((o) => o.status === 'placed').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return [...fresh, ...items.filter((o) => o.status !== 'placed')];
}

function Chip({ label, count, on, onPress, urgent }) {
    const { primary, onPrimary, text, border, error } = useBrand();
    return (
        <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
            <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
            {count > 0 ? (
                <View style={{ marginLeft: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.25) : (urgent ? error : alpha(primary, 0.15)) }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: on ? onPrimary : (urgent ? '#FFFFFF' : primary) }}>{count > 99 ? '99+' : count}</Text>
                </View>
            ) : null}
        </Pressable>
    );
}

// A bulk order that is not paid yet, in the New list: the same place a new order would be, with the bulk tag. Tap = the bulk order (quote, change, send).
function BulkWaitCard({ o, onOpen }) {
    const { primary, text, muted, error } = useBrand();
    const needs = o.status === 'requested';
    const when = o.when ? new Date(o.when).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    return (
        <Card tone={needs ? error : primary} onPress={onOpen}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <View style={{ marginRight: 6 }}><Pill label={`${tr('Bulk Order')} · ${o.code}`} color={primary} icon="cube" /></View>
                <Text style={{ color: needs ? error : muted, fontWeight: '800', fontSize: 12.5 }}>{needs ? tr('Needs your quote') : tr('Quote sent, waiting for the customer')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>{o.contact?.name || tr('A customer')}</Text>
                    {when ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{`${o.fulfilment === 'delivery' ? tr('Delivery') : tr('Pickup')} · ${when}`}</Text> : null}
                </View>
                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{money(o.quote?.pricing?.total ?? o.pricing?.total)}</Text>
            </View>
        </Card>
    );
}

function Skeleton() {
    const { surface, border } = useBrand();
    return (
        <View>
            {[0, 1, 2].map((i) => (
                <View key={i} style={{ marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                    {[120, 220, 160].map((w, k) => <View key={k} style={{ width: w, height: 12, borderRadius: 6, backgroundColor: alpha('#808080', 0.18), marginBottom: 10 }} />)}
                </View>
            ))}
        </View>
    );
}

export default function OwnerOrdersScreen() {
    const nav = useNavigation();
    const route = useRoute();
    const { primary, muted } = useBrand();
    const s = useOrdersStore();
    const access = useOwnerStore((st) => st.access);
    const { items: bulkWait, reload: reloadBulk } = useBulkAwaiting();   // bulk requests and sent quotes not paid yet: they live in New until the advance is paid
    const live = useOwnerStore((st) => st.live);
    const [typed, setTyped] = useState('');
    const debounce = useRef(null);
    const [unpaid, setUnpaid] = useState(false);   // the "Unpaid bills" tag: customers who left without paying
    const [debts, loadDebts] = useDebts(true);
    const [openDebt, setOpenDebt] = useState(null);
    useEffect(() => { if (route.params?.filter === 'unpaid') setUnpaid(true); }, [route.params?.filter, route.params?.stamp]);

    const actions = useOrderActions();

    // another screen may ask for a chip: navigate('OrdersTab', { filter: 'placed' })
    useEffect(() => {
        const f = route.params?.filter;
        if (f && (BOARD_FILTERS.some((x) => x[0] === f))) useOrdersStore.getState().setFilter(f);
    }, [route.params?.filter, route.params?.stamp]);

    useFocusEffect(useCallback(() => { useOrdersStore.getState().load({ quiet: true }); useOwnerStore.getState().refresh(); }, []));

    // an order changed (new, accepted by another phone, rider answered...): refresh, but not on every single event
    useEffect(() => {
        let t = null;
        const off = onOrderUpdate(() => {
            clearTimeout(t);
            t = setTimeout(() => { useOrdersStore.getState().load({ quiet: true }); useOwnerStore.getState().refresh(); }, 400);
        });
        return () => { off(); clearTimeout(t); };
    }, []);

    const onType = (v) => {
        setTyped(v);
        clearTimeout(debounce.current);
        debounce.current = setTimeout(() => useOrdersStore.getState().setQuery(v), 400);
    };

    const active = live?.orders?.active || s.counts || {};
    const activeTotal = ACTIVE_STAGES.reduce((n, k) => n + (active[k] || 0), 0) + bulkWait.length;
    const countOf = (id) => (id === 'active' ? activeTotal : id === 'table' ? s.counts?.table || 0 : (id === 'delivered' || id === 'cancelled' || id === 'history') ? 0 : (active[id] || 0) + (id === 'placed' ? bulkWait.length : 0));

    const data = useMemo(() => arrange(s.items, s.filter), [s.items, s.filter]);
    const searching = /^\d{1,9}$/.test(s.query.trim());

    const desk = useOwnerDesktop();
    // on a computer the board shows every live stage at once: the phone's per-stage chips become columns
    useEffect(() => {
        if (desk && !unpaid && !BOARD_TABS.some((t) => t[0] === s.filter)) useOrdersStore.getState().setFilter('active');
    }, [desk, unpaid, s.filter]);
    // the board needs all the live orders, not the first page of them
    useEffect(() => {
        if (desk && s.filter === 'active' && s.hasMore && !s.loading && !s.loadingMore) useOrdersStore.getState().loadMore();
    }, [desk, s.filter, s.hasMore, s.loading, s.loadingMore, s.items.length]);

    const header = (
        <View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                <Field value={typed} onChangeText={onType} placeholder={tr('Find by order number')} maxLength={9} style={{ minHeight: 44 }} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                {debts?.length || unpaid ? <Chip label={tr('Unpaid bills')} count={debts?.length || 0} on={unpaid} urgent onPress={() => setUnpaid(true)} /> : null}
                {BOARD_FILTERS.map(([id, label]) => (
                    <Chip key={id} label={tr(label)} count={countOf(id)} on={!unpaid && s.filter === id} urgent={id === 'placed'} onPress={() => { setUnpaid(false); useOrdersStore.getState().setFilter(id); }} />
                ))}
            </ScrollView>
            {!unpaid && !/^d{1,9}$/.test(s.query.trim()) && (s.filter === 'placed' || s.filter === 'active') ? bulkWait.map((o) => <BulkWaitCard key={o.id} o={o} onOpen={() => nav.navigate('OwnerBulkOrder', { id: String(o.id) })} />) : null}
            {unpaid && debts?.length ? <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><RemindAll count={debts.length} onDone={loadDebts} /></View> : null}
        </View>
    );

    const openOrder = (item) => {
        nav.navigate('OwnerOrder', { id: String(item.id) });
        setTimeout(() => useOwnerStore.getState().refresh?.(), 1200);
    };
    if (desk) {
        const byCol = {};
        BOARD_COLS.forEach(([id]) => { byCol[id] = []; });
        data.forEach((o) => { const k = boardStatus(o); if (byCol[k]) byCol[k].push(o); });
        const orderCard = (o) => (
            <OrderCard key={o.id} order={o} busy={actions.busyId === o.id} onOpen={() => openOrder(o)} onAdvance={actions.advance} onFoodReady={actions.foodReady} onReject={actions.requestReject} />
        );
        const onBoard = !unpaid && s.filter === 'active';
        return (
            <OwnerScreen title={tr('Orders')} scroll={false}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 14, paddingTop: 4 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                        {BOARD_TABS.map(([id, label]) => <DeskTab key={id} label={tr(label)} count={id === 'active' ? activeTotal : countOf(id)} on={!unpaid && s.filter === id} urgent={false} onPress={() => { setUnpaid(false); useOrdersStore.getState().setFilter(id); }} />)}
                        {debts?.length || unpaid ? <DeskTab label={tr('Unpaid bills')} count={debts?.length || 0} on={unpaid} urgent onPress={() => setUnpaid(true)} /> : null}
                    </ScrollView>
                    <View style={{ width: 280, marginLeft: 12 }}><Field value={typed} onChangeText={onType} placeholder={tr('Find by order number')} maxLength={9} style={{ minHeight: 42 }} /></View>
                </View>
                {s.error && !s.items.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load the orders')} hint={s.error} /> : null}
                {onBoard ? (
                    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: '100%', paddingHorizontal: 16, paddingBottom: 16 }} showsHorizontalScrollIndicator={false}>
                        {BOARD_COLS.map(([id, label, icon]) => {
                            const list = byCol[id];
                            const bulk = id === 'placed' && !searching ? bulkWait : [];
                            const n = list.length + bulk.length;
                            return (
                                <View key={id} style={{ flex: 1, minWidth: 290, marginHorizontal: 8, borderRadius: 18, backgroundColor: alpha(id === 'placed' ? '#F59E0B' : '#808080', id === 'placed' ? 0.1 : 0.07), padding: 10 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 8 }}>
                                        <Ionicons name={icon} size={18} color={id === 'placed' ? '#F59E0B' : muted} />
                                        <Text style={{ flex: 1, marginLeft: 8, color: muted, fontWeight: '900', fontSize: 14, letterSpacing: 0.3 }}>{tr(label).toUpperCase()}</Text>
                                        <View style={{ minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: n && id === 'placed' ? '#F59E0B' : alpha('#808080', 0.2) }}><Text style={{ fontWeight: '900', fontSize: 12, color: n && id === 'placed' ? '#FFFFFF' : muted }}>{n}</Text></View>
                                    </View>
                                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                                        {bulk.map((o) => <BulkWaitCard key={o.id} o={o} onOpen={() => nav.navigate('OwnerBulkOrder', { id: String(o.id) })} />)}
                                        {list.map(orderCard)}
                                        {n === 0 && !s.loading ? <Text style={{ color: muted, textAlign: 'center', paddingVertical: 28, fontSize: 13 }}>{tr('Nothing here')}</Text> : null}
                                    </ScrollView>
                                </View>
                            );
                        })}
                    </ScrollView>
                ) : (
                    <FlatList
                        key="grid3"
                        numColumns={3}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                        data={unpaid ? (debts || []) : (s.loading ? [] : data)}
                        keyExtractor={(o) => String(o.id)}
                        ListHeaderComponent={unpaid && debts?.length ? <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}><RemindAll count={debts.length} onDone={loadDebts} /></View> : null}
                        renderItem={({ item }) => <View style={{ width: '33.333%', paddingHorizontal: 8 }}>{unpaid ? <DebtCard d={item} onOpen={() => setOpenDebt(item)} /> : orderCard(item)}</View>}
                        ListEmptyComponent={s.loading && !unpaid ? <Skeleton /> : <Empty icon={unpaid ? 'checkmark-circle-outline' : 'receipt-outline'} title={unpaid ? tr('No unpaid bills') : searching ? tr('No order with that number') : tr('Nothing here')} hint={unpaid ? tr('Customers who leave a table without paying will show here.') : tr('Orders in this stage will show here.')} />}
                        ListFooterComponent={s.loadingMore ? <ListShimmer count={1} /> : <View style={{ height: 24 }} />}
                        onEndReachedThreshold={0.4}
                        onEndReached={() => useOrdersStore.getState().loadMore()}
                        showsVerticalScrollIndicator={false}
                        extraData={actions.busyId}
                    />
                )}
                <DebtSheet debt={openDebt} onClose={() => setOpenDebt(null)} onChanged={loadDebts} />
                {actions.sheets}
            </OwnerScreen>
        );
    }

    return (
        <OwnerScreen title={tr('Orders')} scroll={false}>
            <FlatList
                data={unpaid ? (debts || []) : (s.loading ? [] : data)}
                keyExtractor={(o) => String(o.id)}
                ListHeaderComponent={header}
                renderItem={unpaid ? ({ item }) => <DebtCard d={item} onOpen={() => setOpenDebt(item)} /> : ({ item }) => (
                    <View style={{ paddingHorizontal: 0 }}>
                        <OrderCard
                            order={item}
                            busy={actions.busyId === item.id}
                            onOpen={() => {
                                nav.navigate('OwnerOrder', { id: String(item.id) });
                                setTimeout(() => useOwnerStore.getState().refresh?.(), 1200);   // the Orders tab stops blinking once nothing is left
                            }}
                            onAdvance={actions.advance}
                            onFoodReady={actions.foodReady}
                            onReject={actions.requestReject}
                        />
                    </View>
                )}
                ListEmptyComponent={unpaid ? <Empty icon="checkmark-circle-outline" title={tr('No unpaid bills')} hint={tr('Customers who leave a table without paying will show here.')} /> : s.loading ? <Skeleton /> : s.error ? (
                    <Empty icon="cloud-offline-outline" title={tr('Could not load the orders')} hint={s.error} />
                ) : (bulkWait.length > 0 && !searching && (s.filter === 'placed' || s.filter === 'active')) ? null : (   // (the bulk cards above are the content)
                    <Empty
                        icon="receipt-outline"
                        title={searching ? tr('No order with that number') : s.filter === 'active' ? tr('No orders right now') : tr('Nothing here')}
                        hint={searching ? tr('Check the number and try again.') : s.filter === 'active' ? tr('New orders appear here the moment a customer places them, with a sound.') : tr('Orders in this stage will show here.')}
                    />
                )}
                ListFooterComponent={s.loadingMore ? <ListShimmer count={1} /> : <View style={{ height: 24 }} />}
                onEndReachedThreshold={0.4}
                onEndReached={() => useOrdersStore.getState().loadMore()}
                refreshControl={<RefreshControl refreshing={s.refreshing} onRefresh={() => { useOrdersStore.getState().refresh(); reloadBulk(); }} tintColor={primary} colors={[primary]} />}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                extraData={actions.busyId}
            />
            {access !== 'ok' && !s.loading && !data.length ? (
                <Text style={{ color: muted, textAlign: 'center', paddingHorizontal: 24, marginBottom: 90 }}>{tr('Orders in progress can still be finished.')}</Text>
            ) : null}
            <DebtSheet debt={openDebt} onClose={() => setOpenDebt(null)} onChanged={loadDebts} />
            {actions.sheets}
        </OwnerScreen>
    );
}
