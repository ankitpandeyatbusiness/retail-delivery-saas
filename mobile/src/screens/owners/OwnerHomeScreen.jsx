// Home: the owner's control room. What needs him now comes first, then how the day is going, then the small things.
// One call (GET /shop/dashboard) fills it; it refreshes whenever an order changes anywhere.
import React, { useCallback, useEffect, useState } from 'react';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { View, Text, Pressable } from 'react-native';
import GlowBorder from '../../components/common/GlowBorder';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Stat, Row, Button, Pill, money } from '../../components/owners/ui';
import { Countdown } from '../../components/owners/orderBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useAlertStore } from '../../store/owners/useAlertStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { setAcceptingOrders, fetchStaff, apiError, booking as bookingApi } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { showToast } from '../../components/customers/shop';
import { onOrderUpdate } from '../../api/common/socket';
import { clearAll } from '../../utils/owners/soundbox';
import { useNow } from '../../hooks/owners/useNow';
import * as flow from '../../utils/owners/orderFlow';
import { AutoAcceptCard } from '../../components/owners/AutoAccept';
import OccupiedTables from '../../components/owners/OccupiedTables';
import TableRequests from '../../components/owners/TableRequests';
import { UnpaidHomeCard } from '../../components/owners/UnpaidBills';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const PIPELINE = [
    ['placed', 'New', 'flash'],
    ['accepted', 'Accepted', 'checkmark-circle'],
    ['preparing', 'Cooking', 'flame'],
    ['ready', 'Ready', 'restaurant'],
    ['out_for_delivery', 'On the road', 'bicycle'],
];
const HOUR_LABELS = { 0: '12 AM', 6: '6 AM', 12: '12 PM', 18: '6 PM', 23: '11 PM' };

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

// "Free period": days left and free orders left. Free ends when EITHER runs out. Before the shop goes live it is free
// with no limit (the test orders cost nothing).
function FreePeriod({ free, now }) {
    const { text, muted, primary, ok, accent } = useBrand();
    if (!free || !free.active) return null;
    const warn = accent || '#F59E0B';
    const total = free.freeOrders || 0;
    const left = free.ordersLeft ?? total;
    const used = Math.max(0, total - left);
    const days = free.endsAt ? Math.max(0, Math.ceil((new Date(free.endsAt).getTime() - now) / 86400000)) : null;
    const low = (total > 0 && left <= Math.max(5, total * 0.1)) || (days !== null && days <= 7);
    const color = low ? warn : ok;
    return (
        <Card tone={color}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="gift" size={22} color={color} />
                <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1, marginLeft: 8 }}>{free.live === false ? tr('Free while you set up') : tr('Your free period')}</Text>
                <Pill label={tr('FREE')} color={color} />
            </View>
            {free.live === false ? (
                <Text style={{ color: muted, marginTop: 8 }}>{tr('Nothing is charged while you test. Your {v1} free months and {total} free orders start when your shop goes live.', { v1: free.freeMonths || 2, total: total })}</Text>
            ) : (
                <>
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <Stat label={tr('Days left')} value={days === null ? '–' : String(days)} hint={free.endsAt ? tr('until {v1}', { v1: new Date(free.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }) : undefined} color={days !== null && days <= 7 ? warn : undefined} />
                        <Stat label={tr('Free orders left')} value={String(left)} hint={tr('of {total}', { total: total })} color={left <= Math.max(5, total * 0.1) ? warn : undefined} />
                    </View>
                    {total > 0 ? (
                        <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(muted, 0.2), marginTop: 12 }}>
                            <View style={{ width: `${Math.min(100, (used / total) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
                        </View>
                    ) : null}
                    {low ? <Text style={{ color, fontWeight: '800', marginTop: 10 }}>{tr('Your free period is ending soon. After it ends, the monthly fee starts (see Money, Monthly bill).')}</Text> : null}
                    <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('The free period ends when you reach {total} delivered orders or when the days run out, whichever comes first.', { total: total })}</Text>
                </>
            )}
        </Card>
    );
}

export default function OwnerHomeScreen() {
    const nav = useNavigation();
    const { muted, primary, onPrimary, error, ok, text, accent } = useBrand();
    const live = useOwnerStore((st) => st.live);
    const d = useOwnerStore((st) => st.dashboard);
    const billing = useOwnerStore((st) => st.billing);
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
    // the cooks and waiters (only the jobs the platform switched on for this shop are shown)
    const [staff, setStaff] = useState(null);
    const easy = useMenuFlags((s) => s.easy);
    const bookingOn = useMenuFlags((s) => s.bookingOn);   // the super admin switched Table booking on for this shop
    const [pendingRes, setPendingRes] = useState({ count: 0, first: null });   // reservations waiting for Allow
    const loadPending = useCallback(() => { if (bookingOn) bookingApi.pending().then(setPendingRes).catch(() => { }); else setPendingRes({ count: 0, first: null }); }, [bookingOn]);
    useFocusEffect(useCallback(() => { loadPending(); }, [loadPending]));
    useEffect(() => onNotification((n) => { if (String(n?.type || '').startsWith('booking_')) loadPending(); }), [loadPending]);
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
        placed: (active.placed || 0) > 0,                 // accept or reject
        accepted: (attn.accepted || 0) > 0,               // mark preparing
        preparing: (attn.cookingNoRider || 0) > 0 || (attn.kitchenProblems || 0) > 0,   // nobody took it: assign a rider by hand, or the kitchen reported a problem
        ready: (attn.ready || 0) > 0,                     // no rider yet, or waiting to be handed over
        out_for_delivery: lateMin > 0,                    // a delivery is late
    };
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
        if (d.rent.dueAmount) attention.push({ key: 'rent', icon: 'card', color: error, title: `Rent due: ${money(d.rent.dueAmount)}`, sub: d.rent.graceEndsAt ? `Pay before ${flow.dayTime(d.rent.graceEndsAt)}` : 'Please pay it', go: () => nav.navigate('OwnerMoney') });
        if (riders?.cashOwedPaise > 0) attention.push({ key: 'cash', icon: 'cash', color: warn, title: `${money(riders.cashOwedPaise / 100)} cash with riders`, sub: 'Collect it from them', go: () => nav.navigate('RidersTab') });
    }

    return (
        <View style={{ flex: 1 }}>
        <OwnerScreen onRefresh={pull} refreshing={refreshing}>
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
                    </Card>
                </GlowBorder>
            ) : null}

            <AutoAcceptCard />

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

            {/* the free period: how many days and orders are left */}
            <FreePeriod free={billing?.free} now={now} />

            {/* what is happening to the orders, right at the top */}
            <SectionTitle title={tr('Order pipeline')} action={tr('Open orders')} onAction={() => toOrders('active')} />
            <View style={{ flexDirection: 'row', paddingHorizontal: 13 }}>
                {PIPELINE.map(([key, label, icon]) => (
                    // New orders blink with a glowing rim until they are accepted or rejected (the count drops to 0)
                    <GlowBorder key={key} active={!!blink[key]} radius={18} style={{ flex: 1, marginHorizontal: 3, marginBottom: 12 }}>
                        <Card onPress={() => toOrders(key)} style={{ flex: 1, marginHorizontal: 0, marginBottom: 0, paddingHorizontal: 2, alignItems: 'center', paddingVertical: 12 }}>
                            <Ionicons name={icon} size={20} color={active[key] ? primary : muted} />
                            <Text style={{ fontSize: 22, fontWeight: '900', color: active[key] ? primary : muted, marginTop: 2 }}>{active[key] || 0}</Text>
                            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 11, color: muted, fontWeight: '700', maxWidth: '100%' }}>{label}</Text>
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

            {/* the day */}
            <SectionTitle title={tr('Today')} />
            <Card>
                <View style={{ flexDirection: 'row' }}>
                    <Stat label={tr('Sales')} value={money(d?.today.revenue)} color={primary} />
                    <Stat label={tr('Delivered')} value={String(d?.today.orders ?? '–')} />
                    <Stat label={tr('Average order')} value={money(d?.today.averageOrderValue)} />
                </View>
                {/* Easy mode keeps the three numbers; the comparison, the hour chart and the extra counts are one switch away */}
                {!easy ? (<>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    {change === null ? (
                        <Text style={{ color: muted, fontSize: 12 }}>{d ? tr('No sales yesterday at this time to compare with') : ''}</Text>
                    ) : (
                        <Pill label={tr('{v1} {v2}% vs yesterday so far', { v1: change >= 0 ? '▲' : '▼', v2: Math.abs(change) })} color={change >= 0 ? ok : error} />
                    )}
                </View>
                {d ? <View style={{ marginTop: 14 }}><HourBars byHour={d.byHour} nowHour={nowHour} /></View> : null}
                {d ? (
                    <View style={{ flexDirection: 'row', marginTop: 14 }}>
                        <Stat label={tr('Orders placed')} value={String(d.today.placed)} />
                        <Stat label={tr('Cancelled')} value={String(d.today.cancelled.count)} hint={d.today.cancelled.count ? tr('{money} lost', { money: money(d.today.cancelled.lost) }) : null} color={d.today.cancelled.count ? error : undefined} />
                        <Stat label={tr('Time to accept')} value={flow.spanText(d.today.averageAcceptSeconds)} />
                    </View>
                ) : null}
                </>) : null}
            </Card>

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

            <SectionTitle title={tr('Delivery')} />
            <Card>
                <Row
                    icon="bicycle"
                    title={tr('Riders')}
                    subtitle={riders ? (riders.total ? tr('{online} online · {free} free · {total} in all', { online: riders.online, free: riders.free, total: riders.total }) : tr('You have not added a rider yet')) : '…'}
                    onPress={() => nav.navigate('RidersTab')}
                    last
                />
            </Card>

            {staff?.rules?.kitchenOn || staff?.rules?.waiterOn ? (
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
        </OwnerScreen>
        {/* the door scanner: a round button that stays on screen, so a guest's booking QR is one tap away */}
        {bookingOn ? (
            <Pressable onPress={() => nav.navigate('BookingScan', { who: 'owner' })} accessibilityRole="button" accessibilityLabel={tr('Scan booking')}
                style={{ position: 'absolute', right: 18, bottom: 22, width: 64, height: 64, borderRadius: 32, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
                <Ionicons name="qr-code" size={30} color={onPrimary} />
            </Pressable>
        ) : null}
        </View>
    );
}
