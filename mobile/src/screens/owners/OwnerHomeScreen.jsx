// Home: the owner's control room. What needs him now comes first, then how the day is going, then the small things.
// One call (GET /shop/dashboard) fills it; it refreshes whenever an order changes anywhere.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Stat, Row, Button, Pill, money } from '../../components/owners/ui';
import { Countdown } from '../../components/owners/orderBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useAlertStore } from '../../store/owners/useAlertStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { setAcceptingOrders, apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { onOrderUpdate } from '../../api/common/socket';
import { clearAll } from '../../utils/owners/soundbox';
import { useNow } from '../../hooks/owners/useNow';
import * as flow from '../../utils/owners/orderFlow';

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
                <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1, marginLeft: 8 }}>{free.live === false ? 'Free while you set up' : 'Your free period'}</Text>
                <Pill label="FREE" color={color} />
            </View>
            {free.live === false ? (
                <Text style={{ color: muted, marginTop: 8 }}>Nothing is charged while you test. Your {free.freeMonths || 2} free months and {total} free orders start when your shop goes live.</Text>
            ) : (
                <>
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <Stat label="Days left" value={days === null ? '–' : String(days)} hint={free.endsAt ? `until ${new Date(free.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : undefined} color={days !== null && days <= 7 ? warn : undefined} />
                        <Stat label="Free orders left" value={String(left)} hint={`of ${total}`} color={left <= Math.max(5, total * 0.1) ? warn : undefined} />
                    </View>
                    {total > 0 ? (
                        <View style={{ height: 8, borderRadius: 4, backgroundColor: alpha(muted, 0.2), marginTop: 12 }}>
                            <View style={{ width: `${Math.min(100, (used / total) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: color }} />
                        </View>
                    ) : null}
                    {low ? <Text style={{ color, fontWeight: '800', marginTop: 10 }}>Your free period is ending soon. After it ends, the monthly fee starts (see Money, Monthly bill).</Text> : null}
                    <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>The free period ends when you reach {total} delivered orders or when the days run out, whichever comes first.</Text>
                </>
            )}
        </Card>
    );
}

export default function OwnerHomeScreen() {
    const nav = useNavigation();
    const { muted, primary, error, ok, text, accent } = useBrand();
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
            showToast('Taking orders again');
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setResuming(false); }
    };

    const active = live?.orders?.active || {};
    const riders = d?.riders;
    const waiting = d?.waiting || [];
    const change = d ? flow.percentChange(d.today.revenue, d.yesterday.revenue) : null;
    const nowHour = new Date(now).getHours();

    // the small things that need him
    const attention = [];
    if (d) {
        if (d.stock.outCount) attention.push({ key: 'out', icon: 'ban', color: error, title: `${d.stock.outCount} item${d.stock.outCount === 1 ? '' : 's'} out of stock`, sub: d.stock.out.slice(0, 3).map((p) => p.name).join(', ') + (d.stock.outCount > 3 ? ' and more' : ''), go: () => nav.navigate('MenuTab') });
        if (d.stock.lowCount) attention.push({ key: 'low', icon: 'trending-down', color: warn, title: `${d.stock.lowCount} item${d.stock.lowCount === 1 ? '' : 's'} running low`, sub: d.stock.low.slice(0, 3).map((p) => `${p.name} (${p.qty})`).join(', '), go: () => nav.navigate('MenuTab') });
        if (d.complaints.open) attention.push({ key: 'cmp', icon: 'chatbubble-ellipses', color: error, title: `${d.complaints.open} open complaint${d.complaints.open === 1 ? '' : 's'}`, sub: 'Customers are waiting for a reply', go: () => nav.navigate('OwnerComplaints') });
        if (d.sms.zero) attention.push({ key: 'sms0', icon: 'mail-unread', color: error, title: 'SMS balance is finished', sub: 'Order alerts by SMS have stopped. Top up.', go: () => nav.navigate('MoneyTab') });
        else if (d.sms.low) attention.push({ key: 'sms', icon: 'mail-unread', color: warn, title: 'SMS balance is low', sub: `${money(d.sms.balancePaise / 100)} left`, go: () => nav.navigate('MoneyTab') });
        if (d.rent.dueAmount) attention.push({ key: 'rent', icon: 'card', color: error, title: `Rent due: ${money(d.rent.dueAmount)}`, sub: d.rent.graceEndsAt ? `Pay before ${flow.dayTime(d.rent.graceEndsAt)}` : 'Please pay it', go: () => nav.navigate('MoneyTab') });
        if (riders?.cashOwedPaise > 0) attention.push({ key: 'cash', icon: 'cash', color: warn, title: `${money(riders.cashOwedPaise / 100)} cash with riders`, sub: 'Collect it from them', go: () => nav.navigate('RidersTab') });
    }

    return (
        <OwnerScreen onRefresh={pull} refreshing={refreshing}>
            {loadError && !d ? <Card tone={error}><Text style={{ color: error, fontWeight: '700' }}>{loadError}</Text></Card> : null}

            {/* a real order is ringing: one tap silences it (opening the order does the same) */}
            {ringing ? (
                <Card tone={error}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="notifications" size={22} color={error} />
                        <Text style={{ color: error, fontWeight: '900', flex: 1, marginLeft: 10 }}>A new order is waiting</Text>
                        <Button label="Silence" icon="volume-mute" kind="danger" onPress={clearAll} />
                    </View>
                </Card>
            ) : null}

            {/* paused */}
            {accepting === false ? (
                <Card tone={error}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="pause-circle" size={24} color={error} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={{ color: error, fontWeight: '900' }}>Orders are paused</Text>
                            <Text style={{ color: muted, fontSize: 12 }}>{pausedUntil ? `Reopens by itself at ${flow.clockTime(pausedUntil)}` : 'Customers can not order until you start again'}</Text>
                        </View>
                        <Button label="Start" icon="play" busy={resuming} onPress={resume} />
                    </View>
                </Card>
            ) : null}

            {/* the free period: how many days and orders are left */}
            <FreePeriod free={billing?.free} now={now} />

            {/* needs him now */}
            {waiting.length ? (
                <Card tone={warn} onPress={() => (waiting.length === 1 ? nav.navigate('OwnerOrder', { id: String(waiting[0].id) }) : toOrders('placed'))}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="flash" size={22} color={warn} />
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1, marginLeft: 8 }}>
                            {waiting.length} new order{waiting.length === 1 ? '' : 's'} waiting
                        </Text>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </View>
                    <Text style={{ color: muted, marginTop: 6 }} numberOfLines={1}>#{waiting[0].orderNo} · {waiting[0].items.join(', ')} · {money(waiting[0].total)}</Text>
                    <View style={{ marginTop: 6 }}><Countdown until={waiting[0].acceptBy} /></View>
                </Card>
            ) : null}

            {/* the day */}
            <SectionTitle title="Today" />
            <Card>
                <View style={{ flexDirection: 'row' }}>
                    <Stat label="Sales" value={money(d?.today.revenue)} color={primary} />
                    <Stat label="Delivered" value={String(d?.today.orders ?? '–')} />
                    <Stat label="Average order" value={money(d?.today.averageOrderValue)} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    {change === null ? (
                        <Text style={{ color: muted, fontSize: 12 }}>{d ? 'No sales yesterday at this time to compare with' : ''}</Text>
                    ) : (
                        <Pill label={`${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs yesterday so far`} color={change >= 0 ? ok : error} />
                    )}
                </View>
                {d ? <View style={{ marginTop: 14 }}><HourBars byHour={d.byHour} nowHour={nowHour} /></View> : null}
                {d ? (
                    <View style={{ flexDirection: 'row', marginTop: 14 }}>
                        <Stat label="Orders placed" value={String(d.today.placed)} />
                        <Stat label="Cancelled" value={String(d.today.cancelled.count)} hint={d.today.cancelled.count ? `${money(d.today.cancelled.lost)} lost` : null} color={d.today.cancelled.count ? error : undefined} />
                        <Stat label="Time to accept" value={flow.spanText(d.today.averageAcceptSeconds)} />
                    </View>
                ) : null}
            </Card>

            <SectionTitle title="Order pipeline" action="Open orders" onAction={() => toOrders('active')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10 }}>
                {PIPELINE.map(([key, label, icon]) => (
                    <Card key={key} onPress={() => toOrders(key)} style={{ width: '29%', marginHorizontal: '2%', alignItems: 'center', paddingVertical: 12 }}>
                        <Ionicons name={icon} size={20} color={active[key] ? primary : muted} />
                        <Text style={{ fontSize: 22, fontWeight: '900', color: active[key] ? primary : muted, marginTop: 2 }}>{active[key] || 0}</Text>
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 11, color: muted, fontWeight: '700', maxWidth: '100%' }}>{label}</Text>
                    </Card>
                ))}
            </View>

            <SectionTitle title="Delivery" />
            <Card>
                <Row
                    icon="bicycle"
                    title="Riders"
                    subtitle={riders ? (riders.total ? `${riders.online} online · ${riders.free} free · ${riders.total} in all` : 'You have not added a rider yet') : '…'}
                    onPress={() => nav.navigate('RidersTab')}
                    last
                />
            </Card>

            <SectionTitle title="Needs your attention" />
            <Card>
                {!d ? <Text style={{ color: muted }}>Loading…</Text> : null}
                {d && !attention.length ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="checkmark-circle" size={22} color={ok} style={{ marginRight: 10 }} />
                        <Text style={{ color: text, fontWeight: '700' }}>All good. Nothing needs you right now.</Text>
                    </View>
                ) : null}
                {attention.map((a, i) => (
                    <Row key={a.key} icon={a.icon} color={a.color} title={a.title} subtitle={a.sub} onPress={a.go} last={i === attention.length - 1} />
                ))}
            </Card>

            <SectionTitle title="Alerts" />
            <Card>
                <Row
                    icon="volume-high"
                    title="Soundbox"
                    subtitle={soundbox ? 'ON: new orders are read out loud, even with the screen off' : 'OFF: no sound for new orders on this phone'}
                    right={<Pill label={soundbox ? 'ON' : 'OFF'} color={soundbox ? undefined : muted} />}
                    onPress={() => nav.navigate('Soundbox')}
                    last
                />
            </Card>

            {live?.feed?.length ? (
                <>
                    <SectionTitle title="Latest" />
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
    );
}
