// Home: the owner's control room. What needs him now comes first, then how the day is going, then the small things.
// One call (GET /shop/dashboard) fills it; it refreshes whenever an order changes anywhere.
import PlanChip from '../../components/owners/PlanChip';
import { usePlanHas } from '../../utils/owners/menuFlags';
import React, { useCallback, useEffect, useState } from 'react';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import GlowBorder from '../../components/common/GlowBorder';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Stat, Row, Button, Pill, Sheet, money } from '../../components/owners/ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { Countdown } from '../../components/owners/orderBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useAlertStore } from '../../store/owners/useAlertStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { fetchOrders, setAcceptingOrders, fetchStaff, apiError, booking as bookingApi, fetchComplaints, updateComplaint } from '../../api/owners/shopApi';
import { ask } from '../../components/common/dialog';
import { COMPLAINT_TYPES } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { onNotification } from '../../api/common/socket';
import { showToast } from '../../components/customers/shop';
import { onOrderUpdate } from '../../api/common/socket';
import { clearAll } from '../../utils/owners/soundbox';
import { useNow } from '../../hooks/owners/useNow';
import { useBulkAwaiting } from '../../hooks/owners/useBulkAwaiting';
import { useInquiriesWaiting } from '../../hooks/owners/useInquiriesWaiting';
import useBulkLive from '../../hooks/common/useBulkLive';
import * as flow from '../../utils/owners/orderFlow';
import OccupiedTables from '../../components/owners/OccupiedTables';
import TableRequests from '../../components/owners/TableRequests';
import { UnpaidHomeCard } from '../../components/owners/UnpaidBills';
import { ListShimmer } from '../../components/owners/shimmer';
import { useOwnerDesktop } from '../../utils/common/layout';
import Masonry, { Sep } from '../../components/common/Masonry';
import { tr } from '../../i18n';

const PIPELINE = [
    ['placed', 'New', 'flash'],
    ['accepted', 'Accepted', 'checkmark-circle'],
    ['preparing', 'Cooking', 'flame'],
    ['ready', 'Ready', 'restaurant'],
    ['out_for_delivery', 'On the road', 'bicycle'],
];
// a bulk order's step, in the owner's words (the card on top)
const BULK_OWNER = { requested: 'Needs your quote', quoted: 'Quote sent, waiting for the customer', confirmed: 'Advance paid', preparing: 'Being made', ready: 'Ready', out_for_delivery: 'On the way' };
const HOUR_LABELS = { 0: '12 AM', 6: '6 AM', 12: '12 PM', 18: '6 PM', 23: '11 PM' };

// On a computer (useOwnerDesktop) the page is a dashboard: a row of big numbers, then the pipeline and the day on the left, the rest on the right.
// On the phone these four wrappers draw nothing of their own (just their children), so the phone page is exactly what it was.
const Frame = ({ desk, children }) => (desk ? <View style={{ width: '100%', maxWidth: 1360, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 4 }}>{children}</View> : <>{children}</>);
const TwoCol = ({ desk, children }) => (desk ? <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>{children}</View> : <>{children}</>);
const Left = ({ desk, children }) => (desk ? <View style={{ flex: 3, minWidth: 0 }}>{children}</View> : <>{children}</>);
const Right = ({ desk, children }) => (desk ? <View style={{ flex: 2, minWidth: 0 }}>{children}</View> : <>{children}</>);

const PIPE_COLOR = { placed: '#F59E0B', accepted: '#3B82F6', preparing: '#F97316', ready: '#10B981', out_for_delivery: '#8B5CF6' };

// the big numbers. A tile with an onPress opens what is behind it (the delivered or the live orders).
function KpiRow({ items }) {
    const { surface, border, text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', marginHorizontal: 8, marginTop: 4, marginBottom: 8 }}>
            {items.map(([label, value, icon, color, sub, onPress]) => (
                <Pressable key={label} onPress={onPress} disabled={!onPress} style={({ hovered }) => ({ flex: 1, marginHorizontal: 8, borderRadius: 22, borderWidth: 1, borderColor: onPress && hovered ? color : border, backgroundColor: onPress && hovered ? alpha(color, 0.06) : surface, overflow: 'hidden', cursor: onPress ? 'pointer' : 'default', boxShadow: onPress && hovered ? `inset 0 0 0 1.5px ${color}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow, border-color', transitionDuration: '140ms' })}>
                    <View pointerEvents="none" style={{ position: 'absolute', right: -26, top: -26, width: 110, height: 110, borderRadius: 55, backgroundColor: alpha(color, 0.1) }} />
                    <View style={{ padding: 18 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={22} color="#FFFFFF" /></View>
                            <Text style={{ flex: 1, color: muted, fontWeight: '800', fontSize: 13.5, marginLeft: 12 }}>{label}</Text>
                            {onPress ? <Ionicons name="arrow-forward-circle" size={20} color={alpha(color, 0.8)} /> : null}
                        </View>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 34, letterSpacing: -0.8, marginTop: 14 }}>{value}</Text>
                        {sub ? <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>{sub}</View> : <View style={{ height: 26 }} />}
                    </View>
                </Pressable>
            ))}
        </View>
    );
}

// the welcome at the top: the shop's gradient, a greeting, whether orders are coming in, and the four things an owner opens most
function DeskHero({ name, who, taking, waiting, onGo }) {
    const { primary, primaryDark, onPrimary } = useBrand();
    const hour = new Date().getHours();
    const hello = hour < 12 ? tr('Good morning') : hour < 17 ? tr('Good afternoon') : tr('Good evening');
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const act = (label, icon, key) => (
        <Pressable key={key} onPress={() => onGo(key)} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 44, borderRadius: 22, marginLeft: 10, backgroundColor: hovered ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.2)', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
            <Ionicons name={icon} size={18} color={onPrimary} />
            <Text style={{ color: onPrimary, fontWeight: '800', fontSize: 14, marginLeft: 8 }}>{label}</Text>
        </Pressable>
    );
    return (
        <LinearGradient colors={[primary, primaryDark || primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 12, borderRadius: 28, overflow: 'hidden', padding: 26 }}>
            <View pointerEvents="none" style={{ position: 'absolute', right: -50, top: -70, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', right: 220, bottom: -90, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: onPrimary, opacity: 0.85, fontSize: 13.5, fontWeight: '700' }}>{date}</Text>
                    <Text style={{ color: onPrimary, fontSize: 30, fontWeight: '900', letterSpacing: -0.6, marginTop: 4 }} numberOfLines={1}>{hello}{who ? `, ${who}` : ''} 👋</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.2)' }}>
                            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: taking ? '#4ADE80' : '#FCA5A5', marginRight: 8 }} />
                            <Text style={{ color: onPrimary, fontWeight: '800', fontSize: 13 }}>{taking ? tr('{name} is taking orders', { name }) : tr('Orders are paused')}</Text>
                        </View>
                        {waiting > 0 ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: '#F59E0B', marginLeft: 10 }}>
                                <Ionicons name="flash" size={14} color="#FFFFFF" />
                                <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 13, marginLeft: 5 }}>{tr('{n} new order(s) waiting', { n: waiting })}</Text>
                            </View>
                        ) : null}
                    </View>
                </View>
                {act(tr('Orders'), 'receipt-outline', 'orders')}
                {act(tr('Add item'), 'add-circle-outline', 'item')}
                {act(tr('Riders'), 'bicycle-outline', 'riders')}
                {act(tr('Reports'), 'trending-up-outline', 'reports')}
            </View>
        </LinearGradient>
    );
}

// the orders behind a number: the ones delivered today, or the live ones. Tap an order to open it.
function OrdersPeek({ kind, onClose, onOpen }) {
    const { text, muted, border, primary, ok, error } = useBrand();
    const [rows, setRows] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        if (!kind) { setRows(null); return undefined; }
        let on = true;
        setRows(null); setErr('');
        fetchOrders(flow.boardParams(kind === 'delivered' ? 'delivered' : 'active', 1, 50)).then((r) => {
            if (!on) return;
            let items = r.items || [];
            if (kind === 'delivered') { const t0 = new Date(); t0.setHours(0, 0, 0, 0); items = items.filter((o) => new Date(o.deliveredAt || o.updatedAt || o.createdAt) >= t0); }
            setRows(items);
        }).catch((e) => { if (on) setErr(apiError(e)); });
        return () => { on = false; };
    }, [kind]);
    return (
        <Sheet visible={!!kind} onClose={onClose} title={kind === 'delivered' ? tr('Delivered today') : tr('Live orders')}>
            {err ? <Text style={{ color: error, padding: 12 }}>{err}</Text> : null}
            {!err && rows === null ? <ListShimmer count={4} /> : null}
            {rows && !rows.length ? <Text style={{ color: muted, textAlign: 'center', padding: 28 }}>{kind === 'delivered' ? tr('Nothing delivered yet today.') : tr('No live orders right now.')}</Text> : null}
            {(rows || []).map((o) => {
                const tone = o.status === 'delivered' ? ok : primary;
                return (
                    <Pressable key={o.id} onPress={() => onOpen(o)} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: hovered ? tone : border, backgroundColor: hovered ? alpha(tone, 0.07) : 'transparent', cursor: 'pointer' })}>
                        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(tone, 0.15), alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name={o.orderType === 'delivery' ? 'bicycle' : o.orderType === 'pickup' ? 'walk' : 'restaurant'} size={20} color={tone} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>#{o.orderNo} · {o.customer?.name || tr('Customer')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{flow.itemsSummary(o)} · {flow.statusLabel(o.status)}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{money(o.pricing?.total)}</Text>
                            <Text style={{ color: muted, fontSize: 11.5, marginTop: 1 }}>{flow.clockTime(o.createdAt)}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} style={{ marginLeft: 8 }} />
                    </Pressable>
                );
            })}
        </Sheet>
    );
}

// today's sales, hour by hour. The current hour is the strong bar.
function HourBars({ byHour, nowHour }) {
    const { primary, muted } = useBrand();
    const max = Math.max(1, ...byHour.map((h) => h.revenue));
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 54 }}>
                {byHour.map((h) => (
                    <View key={h.hour} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <View style={{
                            width: '70%', borderRadius: 3, minHeight: 3, height: `${Math.max(6, (h.revenue / max) * 100)}%`,
                            backgroundColor: h.revenue > 0 ? (h.hour === nowHour ? primary : alpha(primary, 0.5)) : alpha(muted, 0.25),
                        }} />
                    </View>
                ))}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
                {byHour.map((h) => (
                    <View key={h.hour} style={{ flex: 1, alignItems: 'center' }}>
                        {HOUR_LABELS[h.hour] ? <Text numberOfLines={1} style={{ fontSize: 9, color: muted, width: 40, textAlign: 'center' }}>{HOUR_LABELS[h.hour]}</Text> : null}
                    </View>
                ))}
            </View>
        </View>
    );
}

export default function OwnerHomeScreen() {
    const desk = useOwnerDesktop();
    const [peek, setPeek] = useState(null);   // 'delivered' | 'live': the orders behind a big number
    const shopName = useHomeStore((st) => st.full.restaurant?.name);
    const meName = useAuthStore((st) => st.user?.name);
    const staffOk = usePlanHas('staffLogins');   // cooks and waiters are Growth and Pro
    const nav = useNavigation();
    const { muted, primary, onPrimary, error, ok, text, accent } = useBrand();
    const live = useOwnerStore((st) => st.live);
    const d = useOwnerStore((st) => st.dashboard);
    const loadError = useOwnerStore((st) => st.error);
    const refresh = useOwnerStore((st) => st.refresh);
    const soundbox = useSoundboxStore((st) => st.soundbox);
    const ringing = useAlertStore((a) => a.ringing);
    const accepting = useHomeStore((st) => st.full.orders.acceptingOrders);
    const pausedUntil = useHomeStore((st) => st.full.orders.pausedUntil);
    const [refreshing, setRefreshing] = useState(false);
    const [resuming, setResuming] = useState(false);
    const now = useNow(60000, true);
    const warn = accent || '#F59E0B';

    useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
    // the oldest complaint nobody has decided: shown on the card with a button to close it
    const openComplaints = d?.complaints?.open || 0;
    const [firstCmp, setFirstCmp] = useState(null);
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        if (!openComplaints) { setFirstCmp(null); return undefined; }
        let on = true;
        (async () => {
            try {
                let r = await fetchComplaints({ status: 'open' });
                let it = (r.items || []).slice(-1)[0];   // the list is newest first: the last one is the oldest
                if (!it) { r = await fetchComplaints({ status: 'in_progress' }); it = (r.items || []).slice(-1)[0]; }
                if (on) setFirstCmp(it || null);
            } catch (e) { /* the card still opens the list */ }
        })();
        return () => { on = false; };
    }, [openComplaints]);
    const closeComplaint = async () => {
        if (!firstCmp || closing) return;
        const yes = await ask({ title: tr('Close this complaint?'), message: tr('The customer is told you closed it. No refund is given. Use it when it is already sorted out.'), confirmText: tr('Close complaint'), cancelText: tr('Not yet') });
        if (!yes) return;
        setClosing(true);
        try { await updateComplaint(firstCmp.id, { resolution: 'closed' }); showToast(tr('Complaint closed')); setFirstCmp(null); await refresh(); }
        catch (e) { showToast(apiError(e)); } finally { setClosing(false); }
    };
    // the cooks and waiters (only the jobs the platform switched on for this shop are shown)
    const [staff, setStaff] = useState(null);
    const easy = useMenuFlags((s) => s.easy);
    const bookingOn = useMenuFlags((s) => s.bookingOn);   // the super admin switched Table booking on for this shop
    const [pendingRes, setPendingRes] = useState({ count: 0, first: null });   // reservations waiting for Allow
    const loadPending = useCallback(() => { if (bookingOn) bookingApi.pending().then(setPendingRes).catch(() => { }); else setPendingRes({ count: 0, first: null }); }, [bookingOn]);
    useFocusEffect(useCallback(() => { loadPending(); }, [loadPending]));
    useEffect(() => onNotification((n) => { if (String(n?.type || '').startsWith('booking_')) loadPending(); }), [loadPending]);
    const { items: bulkWait, needs: bulkNeeds } = useBulkAwaiting();
    const { items: inquiriesWaiting } = useInquiriesWaiting();   // customers who wrote from a service form and are waiting for an answer: a blinking card on top
    useBulkLive(refresh);   // any bulk order changed (its cook ticket made, a stage moved...): the step counts and the "N bulk" tags load again at once
    useFocusEffect(useCallback(() => { fetchStaff().then(setStaff).catch(() => { }); useMenuFlags.getState().refresh(); }, []));   // (the side menu's rows are ready before it opens)
    // an order changed anywhere: update the numbers (a moment later, so a burst of events is one refresh)
    useEffect(() => {
        let t = null;
        const off = onOrderUpdate(() => { clearTimeout(t); t = setTimeout(refresh, 500); });
        return () => { off(); clearTimeout(t); };
    }, [refresh]);

    const pull = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };
    const toOrders = (filter) => nav.navigate('OrdersTab', { filter, stamp: Date.now() });

    const resume = async () => {
        setResuming(true);
        try {
            await setAcceptingOrders(true);
            await useHomeStore.getState().load();
            refresh();
            showToast(tr('Taking orders again'));
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setResuming(false); }
    };

    const active = live?.orders?.active || {};
    // what waits for the owner: each of these makes its pipeline card blink until it is dealt with
    const attn = live?.orders?.attention || {};
    const lateMin = Math.max(0, ...(attn.roadDue || []).map((d) => Math.floor((now - new Date(d).getTime()) / 60000)));   // the most late delivery on the road, in minutes
    const blink = {
        placed: (active.placed || 0) > 0 || bulkNeeds.length > 0,   // accept or reject; or a bulk request waits for the owner's quote
        accepted: (attn.accepted || 0) > 0,               // mark preparing
        preparing: (attn.cookingNoRider || 0) > 0 || (attn.kitchenProblems || 0) > 0,   // nobody took it: assign a rider by hand, or the kitchen reported a problem
        ready: (attn.ready || 0) > 0,                     // no rider yet, or waiting to be handed over
        out_for_delivery: lateMin > 0,                    // a delivery is late
    };
    const countOf = (key) => (active[key] || 0) + (key === 'placed' ? bulkWait.length : 0);   // New also holds the bulk orders not paid yet
    const bulkIn = (key) => (key === 'placed' ? bulkWait.length : (live?.orders?.bulk?.[key] || 0));   // how many of them are bulk orders
    const riders = d?.riders;
    const staffLine = (role, none) => {
        const people = (staff?.items || []).filter((p) => p.role === role);
        if (!staff) return '…';
        if (!people.length) return tr(none);
        return tr('{on} on duty · {total} in all', { on: people.filter((p) => p.isActive && p.duty === 'on').length, total: people.length });
    };
    const waiting = d?.waiting || [];
    const change = d ? flow.percentChange(d.today.revenue, d.yesterday.revenue) : null;
    const nowHour = new Date(now).getHours();

    // the small things that need him
    const attention = [];
    if (d) {
        if (d.stock.outCount) attention.push({ key: 'out', icon: 'ban', color: error, title: `${d.stock.outCount} item${d.stock.outCount === 1 ? '' : 's'} out of stock`, sub: d.stock.out.slice(0, 3).map((p) => p.name).join(', ') + (d.stock.outCount > 3 ? ' and more' : ''), go: () => nav.navigate('MenuTab') });
        if (d.stock.lowCount) attention.push({ key: 'low', icon: 'trending-down', color: warn, title: `${d.stock.lowCount} item${d.stock.lowCount === 1 ? '' : 's'} running low`, sub: d.stock.low.slice(0, 3).map((p) => `${p.name} (${p.qty})`).join(', '), go: () => nav.navigate('MenuTab') });
        if (d.sms.zero) attention.push({ key: 'sms0', icon: 'mail-unread', color: error, title: 'SMS balance is finished', sub: 'Order alerts by SMS have stopped. Top up.', go: () => nav.navigate('OwnerMoney') });
        else if (d.sms.low) attention.push({ key: 'sms', icon: 'mail-unread', color: warn, title: 'SMS balance is low', sub: `${money(d.sms.balancePaise / 100)} left`, go: () => nav.navigate('OwnerMoney') });
        if (riders?.cashOwedPaise > 0) attention.push({ key: 'cash', icon: 'cash', color: warn, title: `${money(riders.cashOwedPaise / 100)} cash with riders`, sub: 'Collect it from them', go: () => nav.navigate('OwnerRiders') });
    }

    return (
        <View style={{ flex: 1 }}>
        <OwnerScreen onRefresh={pull} refreshing={refreshing} wide>
            <Frame desk={desk}>
            <PlanChip />
            {loadError && !d ? <Card tone={error}><Text style={{ color: error, fontWeight: '700' }}>{loadError}</Text></Card> : null}


            {/* something needs him now (the delivery partner cancelled or asked for help, nobody took an order, a very late delivery) */}
            {false ? (
                <GlowBorder active radius={18} style={{ marginHorizontal: 16, marginTop: 14, marginBottom: 16 }}>
                    <Card onPress={() => toOrders('look')} style={{ marginHorizontal: 0, marginBottom: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="warning" size={22} color={error} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: error, fontWeight: '900' }}>{attn.look.urgent === 1 ? tr('1 order needs you now') : tr('{n} orders need you now', { n: attn.look.urgent })}</Text>
                                {attn.look.top ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{`#${attn.look.top.orderNo} · ${tr(attn.look.top.text)}`}</Text> : null}
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={muted} />
                        </View>
                    </Card>
                </GlowBorder>
            ) : null}

            {/* a real order is ringing: one tap silences it (opening the order does the same) */}
            {ringing ? (
                <Card tone={error}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="notifications" size={22} color={error} />
                        <Text style={{ color: error, fontWeight: '900', flex: 1, marginLeft: 10 }}>{tr('A new order is waiting')}</Text>
                    </View>
                    <Button label={tr('Silence')} icon="volume-mute" kind="danger" onPress={clearAll} style={{ marginTop: 10 }} />
                </Card>
            ) : null}

            {/* reservations paid and waiting for Allow: on top, like the complaints, until they are answered */}
            {bookingOn && pendingRes.count > 0 ? (
                <GlowBorder active radius={18} style={{ marginHorizontal: 16, marginTop: 14, marginBottom: 16 }}>
                    <Card onPress={() => nav.navigate('OwnerBookings', { filter: 'pending', stamp: Date.now() })} style={{ marginHorizontal: 0, marginBottom: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="calendar" size={22} color={error} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: error, fontWeight: '900' }}>{pendingRes.count === 1 ? tr('1 reservation needs your answer') : tr('{n} reservations need your answer', { n: pendingRes.count })}</Text>
                                {pendingRes.first ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{`${pendingRes.first.name} · ${tr('{n} guests', { n: pendingRes.first.party })} · ${pendingRes.first.date} ${pendingRes.first.time}`}</Text> : null}
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={muted} />
                        </View>
                    </Card>
                </GlowBorder>
            ) : null}

            {/* service inquiries (party booking, tiffin, your own services) nobody has opened yet: on top, blinking, until the owner opens them */}
            {inquiriesWaiting.length > 0 ? (() => {
                const first = inquiriesWaiting[0];
                const one = inquiriesWaiting.length === 1;
                return (
                    <GlowBorder active radius={18} style={{ marginHorizontal: 16, marginTop: 14, marginBottom: 16 }}>
                        <Card onPress={() => (one ? nav.navigate('OwnerInquiry', { id: String(first._id || first.id) }) : nav.navigate('OwnerInquiries'))} style={{ marginHorizontal: 0, marginBottom: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="chatbubbles" size={22} color={error} />
                                <View style={{ flex: 1, marginLeft: 10 }}>
                                    <Text style={{ color: error, fontWeight: '900' }}>{one ? tr('1 inquiry is waiting for your answer') : tr('{n} inquiries are waiting for your answer', { n: inquiriesWaiting.length })}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{`${first.serviceName || tr('Service')} · ${first.name || tr('A customer')}`}</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={muted} />
                            </View>
                        </Card>
                    </GlowBorder>
                );
            })() : null}

            {/* complaints nobody has answered: always on top, blinking, until they are decided */}
            {d?.complaints?.open ? (
                <GlowBorder active radius={18} style={{ marginHorizontal: 16, marginTop: 14, marginBottom: 16 }}>
                    <Card onPress={() => nav.navigate('OwnerComplaints')} style={{ marginHorizontal: 0, marginBottom: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="chatbubble-ellipses" size={22} color={error} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: error, fontWeight: '900' }}>{tr('{n} complaint(s) not resolved', { n: d.complaints.open })}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Customers are waiting. Please answer now.')}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={muted} />
                        </View>
                        {firstCmp ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: alpha(error, 0.25) }}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={{ color: text, fontWeight: '800', fontSize: 13.5 }} numberOfLines={1}>{(firstCmp.bulkCode ? tr('Bulk order {c}', { c: firstCmp.bulkCode }) : `#${firstCmp.orderNo}`)} · {COMPLAINT_TYPES[firstCmp.type] || firstCmp.type}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{firstCmp.customerName || tr('Customer')} · {ago(firstCmp.createdAt)}</Text>
                                </View>
                                <Pressable onPress={closeComplaint} disabled={closing} hitSlop={6} accessibilityRole="button" style={({ hovered }) => ({ marginLeft: 10, paddingHorizontal: 16, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: error, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? alpha(error, 0.12) : 'transparent', opacity: closing ? 0.6 : 1, cursor: 'pointer' })}>
                                    <Text style={{ color: error, fontWeight: '900', fontSize: 13 }}>{closing ? '…' : tr('Close')}</Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </Card>
                </GlowBorder>
            ) : null}


            {/* paused */}
            {accepting === false ? (
                <Card tone={error}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="pause-circle" size={24} color={error} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={{ color: error, fontWeight: '900' }}>{tr('Orders are paused')}</Text>
                            <Text style={{ color: muted, fontSize: 12 }}>{pausedUntil ? tr('Reopens by itself at {v1}', { v1: flow.clockTime(pausedUntil) }) : tr('Customers can not order until you start again')}</Text>
                        </View>
                    </View>
                    <Button label={tr('Start')} icon="play" busy={resuming} onPress={resume} style={{ marginTop: 10 }} />
                </Card>
            ) : null}
            {desk ? <DeskHero name={shopName || ''} who={String(meName || '').split(' ')[0]} taking={accepting !== false} waiting={(active.placed || 0) + bulkWait.length} onGo={(k) => (k === 'orders' ? toOrders('active') : k === 'item' ? nav.navigate('OwnerItem', {}) : k === 'riders' ? nav.navigate('OwnerRiders') : nav.navigate('OwnerBusiness', { range: '7' }))} /> : null}
            {desk ? <KpiRow items={[
                [tr('Sales today'), money(d?.today.revenue), 'cash-outline', primary, change === null ? null : <Pill label={`${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% ${tr('vs yesterday')}`} color={change >= 0 ? ok : error} />],
                [tr('Delivered'), String(d?.today.orders ?? '–'), 'checkmark-done-outline', ok, <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700' }}>{tr('Tap to see them')}</Text>, () => setPeek('delivered')],
                [tr('Average order'), money(d?.today.averageOrderValue), 'stats-chart-outline', warn, null],
                [tr('Live orders'), String(PIPELINE.reduce((n, p) => n + countOf(p[0]), 0)), 'flash-outline', error, <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700' }}>{tr('Tap to see them')}</Text>, () => setPeek('live')],
            ]} /> : null}
            <Masonry desk={desk} gap={0}>
            {/* what is happening to the orders, right at the top */}
            <SectionTitle title={tr('Order pipeline')} action={tr('Open orders')} onAction={() => toOrders('active')} />
            <View style={{ flexDirection: 'row', paddingHorizontal: 13 }}>
                {PIPELINE.map(([key, label, icon]) => (
                    // New orders blink with a glowing rim until they are accepted or rejected (the count drops to 0)
                    <GlowBorder key={key} active={!!blink[key]} radius={18} style={{ flex: 1, marginHorizontal: 3, marginBottom: 12 }}>
                        <Card onPress={() => toOrders(key)} style={{ flex: 1, marginHorizontal: 0, marginBottom: 0, paddingHorizontal: 2, alignItems: 'center', paddingVertical: 12 }}>
                            <Ionicons name={icon} size={desk ? 26 : 20} color={countOf(key) ? (desk ? PIPE_COLOR[key] : primary) : muted} />
                            <Text style={{ fontSize: desk ? 32 : 22, fontWeight: '900', color: countOf(key) ? (desk ? PIPE_COLOR[key] : primary) : muted, marginTop: 2 }}>{countOf(key)}</Text>
                            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 11, color: muted, fontWeight: '700', maxWidth: '100%' }}>{tr(label)}</Text>
                            {bulkIn(key) > 0 ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                    <Ionicons name="cube" size={10} color={primary} />
                                    <Text numberOfLines={1} style={{ color: primary, fontSize: 10, fontWeight: '900', marginLeft: 2 }}>{tr('{n} bulk', { n: bulkIn(key) })}</Text>
                                </View>
                            ) : null}
                            {key === 'out_for_delivery' && lateMin > 0 ? (
                                <View style={{ marginTop: 4, backgroundColor: error, borderRadius: 99, paddingHorizontal: 6, paddingVertical: 1 }}>
                                    <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 9.5, fontWeight: '900' }}>{tr('Late {min}m', { min: lateMin })}</Text>
                                </View>
                            ) : null}
                        </Card>
                    </GlowBorder>
                ))}
            </View>

            <OccupiedTables />
            <TableRequests />
            <UnpaidHomeCard />

            <Sep />
            {/* needs him now */}
            {waiting.length ? (
                <Card tone={warn} onPress={() => (waiting.length === 1 ? nav.navigate('OwnerOrder', { id: String(waiting[0].id) }) : toOrders('placed'))}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="flash" size={22} color={warn} />
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1, marginLeft: 8 }}>{tr('{length} new order{v2} waiting', { length: waiting.length, v2: waiting.length === 1 ? '' : 's' })}</Text>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </View>
                    <Text style={{ color: muted, marginTop: 6 }} numberOfLines={1}>#{waiting[0].orderNo} · {waiting[0].items.join(', ')} · {money(waiting[0].total)}</Text>
                    <View style={{ marginTop: 6 }}><Countdown until={waiting[0].acceptBy} /></View>
                </Card>
            ) : null}

            <Sep />
            {/* the day */}
            {desk && easy ? null : (<>
            <SectionTitle title={tr('Today')} />
            <Card>
                {desk ? null : <View style={{ flexDirection: 'row' }}>
                    <Stat label={tr('Sales')} value={money(d?.today.revenue)} color={primary} />
                    <Stat label={tr('Delivered')} value={String(d?.today.orders ?? '–')} />
                    <Stat label={tr('Average order')} value={money(d?.today.averageOrderValue)} />
                </View>}
                {/* Easy mode keeps the three numbers; the comparison, the hour chart and the extra counts are one switch away */}
                {!easy ? (<>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    {change === null ? (
                        <Text style={{ color: muted, fontSize: 12 }}>{d ? tr('No sales yesterday at this time to compare with') : ''}</Text>
                    ) : (
                        <Pill label={tr('{v1} {v2}% vs yesterday so far', { v1: change >= 0 ? '▲' : '▼', v2: Math.abs(change) })} color={change >= 0 ? ok : error} />
                    )}
                </View>
                {d && desk && !d.today.placed && !d.today.revenue ? (
                    <View style={{ alignItems: 'center', paddingVertical: 26 }}>
                        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: alpha(primary, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="sunny-outline" size={26} color={primary} /></View>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16, marginTop: 10 }}>{tr('No orders yet today')}</Text>
                        <Text style={{ color: muted, fontSize: 13, marginTop: 3, textAlign: 'center' }}>{tr('Your sales chart fills in as orders come in.')}</Text>
                    </View>
                ) : d ? <View style={{ marginTop: 14 }}><HourBars byHour={d.byHour} nowHour={nowHour} /></View> : null}
                {d ? (
                    <View style={{ flexDirection: 'row', marginTop: 14 }}>
                        <Stat label={tr('Orders placed')} value={String(d.today.placed)} />
                        <Stat label={tr('Cancelled')} value={String(d.today.cancelled.count)} hint={d.today.cancelled.count ? tr('{money} lost', { money: money(d.today.cancelled.lost) }) : null} color={d.today.cancelled.count ? error : undefined} />
                        <Stat label={tr('Time to accept')} value={flow.spanText(d.today.averageAcceptSeconds)} />
                    </View>
                ) : null}
                </>) : null}
            </Card>
            </>)}

            <Sep />
            {/* the week in one line, and the way to the full report */}
            {d && !easy ? (
                <Card onPress={() => nav.navigate('OwnerBusiness', { range: '7' })}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="trending-up" size={24} color={primary} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('See how your shop is growing')}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Charts, best food, your best rider and tips, for the last 7 days or more')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </View>
                </Card>
            ) : null}

            <Sep />
            <SectionTitle title={tr('Delivery')} />
            <Card>
                <Row
                    icon="bicycle"
                    title={tr('Riders')}
                    subtitle={riders ? (riders.total ? tr('{online} online · {free} free · {total} in all', { online: riders.online, free: riders.free, total: riders.total }) : tr('You have not added a rider yet')) : '…'}
                    onPress={() => nav.navigate('OwnerRiders')}
                    last
                />
            </Card>

            <Sep />
            {staffOk && (staff?.rules?.kitchenOn || staff?.rules?.waiterOn) ? (
                <>
                    <SectionTitle title={tr('Staff')} />
                    <Card>
                {staff?.rules?.kitchenOn ? (
                    <Row
                        icon="flame"
                        title={tr('Kitchen staff')}
                        subtitle={staffLine('kitchen', 'You have not added a cook yet')}
                        onPress={() => nav.navigate('OwnerCooks')}
                        last={!staff?.rules?.waiterOn}
                    />
                ) : null}
                {staff?.rules?.waiterOn ? (
                    <Row
                        icon="restaurant"
                        title={tr('Waiters')}
                        subtitle={staffLine('waiter', 'You have not added a waiter yet')}
                        onPress={() => nav.navigate('OwnerWaiters')}
                        last={true}
                    />
                ) : null}
                    </Card>
                </>
            ) : null}

            <Sep />
            <SectionTitle title={tr('Needs your attention')} />
            <Card>
                {!d ? <ListShimmer count={3} /> : null}
                {d && !attention.length ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="checkmark-circle" size={22} color={ok} style={{ marginRight: 10 }} />
                        <Text style={{ color: text, fontWeight: '700' }}>{tr('All good. Nothing needs you right now.')}</Text>
                    </View>
                ) : null}
                {attention.map((a, i) => (
                    <Row key={a.key} icon={a.icon} color={a.color} title={a.title} subtitle={a.sub} onPress={a.go} last={i === attention.length - 1} />
                ))}
            </Card>

            <Sep />
            <SectionTitle title={tr('Alerts')} />
            <Card>
                <Row
                    icon="volume-high"
                    title={tr('Soundbox')}
                    subtitle={soundbox ? tr('ON: new orders are read out loud, even with the screen off') : tr('OFF: no sound for new orders on this phone')}
                    right={<Pill label={soundbox ? tr('ON') : tr('OFF')} color={soundbox ? undefined : muted} />}
                    onPress={() => nav.navigate('Soundbox')}
                    last
                />
            </Card>

            <Sep />
            {!easy && live?.feed?.length ? (
                <>
                    <SectionTitle title={tr('Latest')} />
                    <Card>
                        {live.feed.slice(0, 8).map((e, i, arr) => (
                            <View key={e.id || i} style={{ flexDirection: 'row', paddingVertical: 7, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: alpha(muted, 0.2) }}>
                                <Text style={{ color: muted, fontSize: 12, width: 62 }}>{flow.clockTime(e.at)}</Text>
                                <Text style={{ color: text, fontSize: 13, flex: 1 }}>{flow.feedLine(e)}</Text>
                            </View>
                        ))}
                    </Card>
                </>
            ) : null}
            </Masonry>
            {desk ? <OrdersPeek kind={peek} onClose={() => setPeek(null)} onOpen={(o) => { setPeek(null); nav.navigate('OwnerOrder', { id: String(o.id) }); }} /> : null}
            </Frame>
        </OwnerScreen>
        {/* the door scanner: a round button that stays on screen, so a guest's booking QR is one tap away */}
        {bookingOn ? (
            <Pressable onPress={() => nav.navigate('BookingScan', { who: 'owner' })} accessibilityRole="button" accessibilityLabel={tr('Scan booking')}
                style={{ position: 'absolute', right: 18, bottom: 22, width: 52, height: 52, borderRadius: 26, backgroundColor: alpha(primary, 0.72), borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
                <Ionicons name="qr-code" size={23} color={onPrimary} />
            </Pressable>
        ) : null}
        </View>
    );
}
