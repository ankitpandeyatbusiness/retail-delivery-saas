// Orders: the live board. Chips for each stage (with counts), search by order number, and the orders as cards with
// Accept / Reject and the next step right on them. It refreshes by itself when an order changes anywhere.
import { CoachTarget } from '../../tutorial/CoachTarget';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, RefreshControl, LayoutAnimation, ActivityIndicator } from 'react-native';
import GlowBorder from '../../components/common/GlowBorder';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Empty, Field, Card, Pill, Button, money } from '../../components/owners/ui';
import { useBulkAwaiting } from '../../hooks/owners/useBulkAwaiting';
import { OrderCard, useOrderActions, PayBadge, Countdown } from '../../components/owners/orderBits';
import { useNow } from '../../hooks/owners/useNow';
import * as flow from '../../utils/owners/orderFlow';
import { useOrdersStore } from '../../store/owners/useOrdersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onOrderUpdate } from '../../api/common/socket';
import { BOARD_FILTERS, boardStatus } from '../../utils/owners/orderFlow';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { ListShimmer } from '../../components/owners/shimmer';
import { DebtCard, DebtSheet, RemindAll, useDebts } from '../../components/owners/UnpaidBills';
import { tr } from '../../i18n';

// the owner's desktop board: one column per stage of a live order (each with its own colour), and the finished ones as a grid under their own tabs
const BOARD_COLS = [
    ['placed', 'New', 'flash', '#F59E0B'],
    ['accepted', 'Accepted', 'checkmark-circle', '#3B82F6'],
    ['preparing', 'Preparing', 'flame', '#F97316'],
    ['ready', 'Ready', 'bag-check', '#10B981'],
    ['out_for_delivery', 'On the road', 'bicycle', '#8B5CF6'],
];
const STAGE_COLOR = Object.fromEntries(BOARD_COLS.map((c) => [c[0], c[3]]));
const BOARD_TABS = [['active', 'Live board', 'flash'], ['placed', 'New', 'alert-circle'], ['accepted', 'Accepted', 'checkmark-circle'], ['preparing', 'Preparing', 'flame'], ['ready', 'Ready', 'bag-check'], ['table', 'On the table', 'restaurant'], ['out_for_delivery', 'On the road', 'bicycle'], ['delivered', 'Delivered', 'checkmark-done'], ['cancelled', 'Cancelled', 'close-circle'], ['history', 'History', 'time']];

function DeskTab({ label, icon, count, on, urgent, onPress }) {
    const { primary, onPrimary, text, error } = useBrand();
    return (
        <Pressable onPress={onPress} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 42, borderRadius: 21, backgroundColor: on ? primary : hovered ? alpha(primary, 0.1) : 'transparent', cursor: 'pointer', boxShadow: on ? `0 6px 16px ${alpha(primary, 0.35)}` : 'none', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
            <Ionicons name={on ? icon : `${icon}-outline`} size={17} color={on ? onPrimary : text} />
            <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 14, marginLeft: 8 }}>{label}</Text>
            {count > 0 ? <View style={{ marginLeft: 8, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.25) : (urgent ? error : primary) }}><Text style={{ fontSize: 12, fontWeight: '900', color: on || urgent ? '#FFFFFF' : onPrimary }}>{count > 99 ? '99+' : count}</Text></View> : null}
        </Pressable>
    );
}

// the big button on a card
function Act({ label, icon, onPress, busy, color, ghost, iconOnly, style }) {
    const { primary, onPrimary, text, border } = useBrand();
    const bg = ghost ? 'transparent' : (color || primary);
    const ink = ghost ? (color || text) : (color ? '#FFFFFF' : onPrimary);
    return (
        <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={iconOnly ? label : undefined}
            style={({ hovered }) => [{ height: 42, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: iconOnly ? 0 : 16, width: iconOnly ? 44 : undefined, backgroundColor: bg, borderWidth: ghost ? 1.5 : 0, borderColor: ghost ? alpha(color || border, 0.5) : 'transparent', cursor: 'pointer', opacity: busy ? 0.7 : hovered ? 0.9 : 1 }, style]}>
            {busy ? <ActivityIndicator size="small" color={ink} /> : (
                <>
                    {icon ? <Ionicons name={icon} size={iconOnly ? 20 : 17} color={ink} /> : null}
                    {iconOnly ? null : <Text style={{ color: ink, fontWeight: '900', fontSize: 14, marginLeft: icon ? 7 : 0 }} numberOfLines={1}>{label}</Text>}
                </>
            )}
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

// One order on the desktop board: a card made for a column. The customer's round letter and the order number on top, how long it has waited (it turns amber, then
// red, while a live order is not moved on), the dishes, how it is paid and the total, and the button for what to do next (the same rules as the phone's card).
function DeskOrderCard({ order, busy, onOpen, onAdvance, onFoodReady, onReject }) {
    const { text, muted, accent, error, primary, surface, border, ok } = useBrand();
    const now = useNow(30000, true);
    const isNew = order.status === 'placed';
    const final = flow.isFinal(order.status);
    const next = flow.forwardStep(order);
    const warn = accent || '#F59E0B';
    const stage = STAGE_COLOR[boardStatus(order)] || (order.status === 'delivered' ? ok : final ? error : primary);
    const mins = Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60000));
    const late = final ? null : mins >= 30 ? error : mins >= 12 ? warn : null;
    const dishes = (flow.itemsSummary(order) || '').split(', ').filter(Boolean);
    const shown = dishes.slice(0, 3);
    const who = String(order.customer?.name || '?').trim();
    const card = (
        <Pressable onPress={onOpen} style={({ hovered }) => ({ borderRadius: 18, borderWidth: 1, borderColor: isNew ? alpha(warn, 0.75) : border, overflow: 'hidden', cursor: 'pointer', backgroundColor: hovered ? alpha(stage, 0.07) : surface, boxShadow: hovered ? `inset 0 0 0 1.5px ${stage}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
            <View pointerEvents="none" style={{ height: 4, backgroundColor: stage }} />
            <View style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(stage, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: stage, fontWeight: '900', fontSize: 17 }}>{(who[0] || '?').toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>#{order.orderNo}</Text>
                            {order.bulkId ? <View style={{ marginLeft: 6, paddingHorizontal: 7, height: 20, borderRadius: 10, backgroundColor: alpha(primary, 0.14), justifyContent: 'center' }}><Text style={{ color: primary, fontSize: 10.5, fontWeight: '900' }}>{tr('BULK')}</Text></View> : null}
                        </View>
                        <Text numberOfLines={1} style={{ color: muted, fontSize: 12.5, fontWeight: '700' }}>{order.customer?.name || tr('Customer')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: alpha(late || muted, 0.14) }}>
                            <Ionicons name="time-outline" size={12.5} color={late || muted} />
                            <Text style={{ color: late || muted, fontSize: 11.5, fontWeight: '900', marginLeft: 4 }}>{flow.ago(order.createdAt, now)}</Text>
                        </View>
                    </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, height: 24, borderRadius: 12, backgroundColor: alpha(stage, 0.13) }}>
                        <Ionicons name={order.orderType === 'delivery' ? 'bicycle' : order.orderType === 'pickup' ? 'walk' : 'restaurant'} size={13} color={stage} />
                        <Text style={{ color: stage, fontSize: 11.5, fontWeight: '900', marginLeft: 5 }}>{flow.typeLabel(order.orderType)}</Text>
                    </View>
                    {order.scheduledFor ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                            <Ionicons name="calendar-outline" size={13} color={muted} />
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700', marginLeft: 4 }}>{flow.dayTime(order.scheduledFor)}</Text>
                        </View>
                    ) : null}
                </View>

                <View style={{ marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: alpha(muted, 0.08) }}>
                    {shown.map((d, i) => <Text key={i} numberOfLines={1} style={{ color: text, fontSize: 13.5, lineHeight: 20 }}>{d}</Text>)}
                    {dishes.length > shown.length ? <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 2 }}>+{dishes.length - shown.length} {tr('more')}</Text> : null}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <View style={{ flex: 1 }}><PayBadge order={order} /></View>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 22, letterSpacing: -0.4 }}>{order.bulkId ? `${tr('Balance')} ${money(order.pricing?.total)}` : money(order.pricing?.total)}</Text>
                </View>

                {order.needsLook && !order.needsLook.seenAt ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10, backgroundColor: alpha(order.needsLook.urgent ? error : warn, 0.13) }}>
                        <Ionicons name={order.needsLook.urgent ? 'warning' : 'information-circle'} size={16} color={order.needsLook.urgent ? error : warn} />
                        <Text style={{ flex: 1, marginLeft: 6, color: order.needsLook.urgent ? error : warn, fontWeight: '800', fontSize: 12 }}>{tr('Please have a look')}</Text>
                    </View>
                ) : null}
                {isNew && order.acceptBy ? <View style={{ marginTop: 10 }}><Countdown until={order.acceptBy} compact /></View> : null}

                {isNew && next ? (
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        {flow.canCancel(order) ? <Act label={tr('Reject')} icon="close" iconOnly ghost color={error} onPress={() => onReject(order)} busy={busy} style={{ marginRight: 8 }} /> : null}
                        <CoachTarget id="accept-order" style={{ flex: 1 }}><Act label={tr('Accept')} icon="checkmark" color={ok} onPress={() => onAdvance(order)} busy={busy} style={{ flex: 1 }} /></CoachTarget>
                    </View>
                ) : null}
                {!isNew && order.orderType === 'delivery' && order.status === 'preparing' && order.foodReady === false && onFoodReady ? (
                    <Act label={tr('Food is ready')} icon="checkmark-done" color={ok} onPress={() => onFoodReady(order)} busy={busy} style={{ marginTop: 12 }} />
                ) : null}
                {!isNew && next && order.foodReady !== false && flow.riderHandles(order, next) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: alpha(STAGE_COLOR.out_for_delivery, 0.1) }}>
                        <Ionicons name="bicycle" size={17} color={STAGE_COLOR.out_for_delivery} />
                        <Text style={{ flex: 1, marginLeft: 8, color: muted, fontWeight: '700', fontSize: 12.5 }}>{next === 'out_for_delivery' ? tr('The delivery partner will collect it.') : tr('On the way.')}</Text>
                    </View>
                ) : null}
                {!isNew && next && !flow.riderHandles(order, next) && !(order.foodReady === false && next === 'out_for_delivery') ? (
                    <Act label={flow.stepLabel(order, next)} onPress={() => onAdvance(order)} busy={busy} color={STAGE_COLOR[next] || primary} style={{ marginTop: 12 }} />
                ) : null}
            </View>
        </Pressable>
    );
    // a new order glows until it is accepted or rejected, like the pipeline on Home
    return <View style={{ marginBottom: 14 }}>{isNew ? <GlowBorder active radius={18}>{card}</GlowBorder> : card}</View>;
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
    const { primary, muted, text, surface, border, ok } = useBrand();
    const s = useOrdersStore();
    const dash = useOwnerStore((st) => st.dashboard);   // today's sales, for the top strip on a computer
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
    const gcols = useGridCols(3, 300);   // fewer, wider cards in a narrow window
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
            <DeskOrderCard key={o.id} order={o} busy={actions.busyId === o.id} onOpen={() => openOrder(o)} onAdvance={actions.advance} onFoodReady={actions.foodReady} onReject={actions.requestReject} />
        );
        const onBoard = !unpaid && s.filter === 'active';
        const waitingNew = (active.placed || 0) + bulkWait.length;
        const kpi = (label, value, icon, color) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 12, paddingHorizontal: 14, height: 56, borderRadius: 16, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: alpha(color, 0.15), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={18} color={color} /></View>
                <View style={{ marginLeft: 10 }}>
                    <Text style={{ color: muted, fontSize: 11, fontWeight: '800' }}>{label}</Text>
                    <Text style={{ color: text, fontSize: 17, fontWeight: '900' }}>{value}</Text>
                </View>
            </View>
        );
        const shownTotal = data.reduce((n, o) => n + (o.pricing?.total || 0), 0);
        return (
            <OwnerScreen title={tr('Orders')} scroll={false}>
                {/* the top of the page: what needs you right now, today's numbers and the search */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginBottom: 14, padding: 16, borderRadius: 22, backgroundColor: alpha(waitingNew ? '#F59E0B' : primary, 0.1), borderWidth: 1, borderColor: alpha(waitingNew ? '#F59E0B' : primary, 0.25) }}>
                    <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: waitingNew ? '#F59E0B' : primary, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={waitingNew ? 'flash' : 'checkmark-done'} size={24} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 14, minWidth: 0 }}>
                        <Text style={{ color: text, fontSize: 20, fontWeight: '900', letterSpacing: -0.3 }}>{waitingNew ? tr('{n} new order(s) waiting for you', { n: waitingNew }) : tr('All caught up')}</Text>
                        <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{tr('{n} live orders on the board', { n: activeTotal })}</Text>
                    </View>
                    {dash ? kpi(tr('Sales today'), money(dash.today?.revenue), 'cash-outline', primary) : null}
                    {dash ? kpi(tr('Delivered'), String(dash.today?.orders ?? '–'), 'checkmark-done-outline', ok) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 14 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 4, borderRadius: 25, backgroundColor: alpha(muted, 0.12) }}>
                            {BOARD_TABS.map(([id, label, icon]) => <DeskTab key={id} label={tr(label)} icon={icon} count={id === 'active' ? activeTotal : countOf(id)} on={!unpaid && s.filter === id} urgent={id === 'placed'} onPress={() => { setUnpaid(false); useOrdersStore.getState().setFilter(id); }} />)}
                            {debts?.length || unpaid ? <DeskTab label={tr('Unpaid bills')} icon="alert-circle" count={debts?.length || 0} on={unpaid} urgent onPress={() => setUnpaid(true)} /> : null}
                        </View>
                    </ScrollView>
                    <View style={{ width: 280, marginLeft: 12 }}><Field value={typed} onChangeText={onType} placeholder={tr('Find by order number')} maxLength={9} style={{ minHeight: 42, borderRadius: 21, paddingHorizontal: 18 }} /></View>
                </View>
                {s.error && !s.items.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load the orders')} hint={s.error} /> : null}
                {onBoard ? (
                    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: '100%', height: '100%', paddingHorizontal: 16, paddingBottom: 16 }} showsHorizontalScrollIndicator={false}>
                        {BOARD_COLS.map(([id, label, icon, color]) => {
                            const list = byCol[id];
                            const bulk = id === 'placed' && !searching ? bulkWait : [];
                            const n = list.length + bulk.length;
                            return (
                                <View key={id} style={{ flex: 1, minWidth: 300, marginHorizontal: 8, borderRadius: 22, backgroundColor: alpha(color, 0.07), borderWidth: 1, borderColor: alpha(color, 0.2), overflow: 'hidden' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: alpha(color, 0.13) }}>
                                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={17} color="#FFFFFF" /></View>
                                        <Text style={{ flex: 1, marginLeft: 10, color: text, fontWeight: '900', fontSize: 15.5 }}>{tr(label)}</Text>
                                        <View style={{ minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: n ? color : alpha(muted, 0.2) }}><Text style={{ fontWeight: '900', fontSize: 13, color: n ? '#FFFFFF' : muted }}>{n}</Text></View>
                                    </View>
                                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
                                        {bulk.map((o) => <View key={o.id} style={{ marginHorizontal: -16 }}><BulkWaitCard o={o} onOpen={() => nav.navigate('OwnerBulkOrder', { id: String(o.id) })} /></View>)}
                                        {list.map(orderCard)}
                                        {n === 0 && !s.loading ? <View style={{ alignItems: 'center', paddingVertical: 44 }}><View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: alpha(color, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={`${icon}-outline`} size={26} color={alpha(color, 0.8)} /></View><Text style={{ color: muted, fontSize: 13.5, fontWeight: '700', marginTop: 10 }}>{tr('Nothing here')}</Text></View> : null}
                                    </ScrollView>
                                </View>
                            );
                        })}
                    </ScrollView>
                ) : (
                    <FlatList
                        key={`grid${gcols}`}
                        numColumns={gcols}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                        data={unpaid ? (debts || []) : (s.loading ? [] : data)}
                        keyExtractor={(o) => String(o.id)}
                        ListHeaderComponent={unpaid ? (debts?.length ? <View style={{ paddingHorizontal: 8, paddingBottom: 12 }}><RemindAll count={debts.length} onDone={loadDebts} /></View> : null) : (data.length ? <Text style={{ color: muted, fontSize: 13, fontWeight: '800', paddingHorizontal: 8, paddingBottom: 12 }}>{tr('{n} orders', { n: data.length })} · {money(shownTotal)}</Text> : null)}
                        renderItem={({ item }) => <View style={{ width: `${100 / gcols}%`, paddingHorizontal: 8 }}>{unpaid ? <DebtCard d={item} onOpen={() => setOpenDebt(item)} /> : orderCard(item)}</View>}
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
