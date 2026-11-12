// The rider's Home: one page. Start or end duty, the new order waiting for him (if any), and the deliveries he is carrying.
// Nothing else. A rider glances at this between stops, so it shows only what needs a decision.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, AppState, Platform } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import GlowBorder from '../../components/common/GlowBorder';
import { useBrand, alpha } from '../../components/common/kit';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { Card, Stat, LiveToggle } from '../../components/owners/ui';
import { BigButton, SmallLink, Banner, Avatar } from '../../components/riders/riderBits';
import KeepRunningSheet from '../../components/riders/KeepRunningSheet';
import BellButton from '../../components/common/BellButton';
import OffDutySheet from '../../components/common/OffDutySheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRiderStore } from '../../store/riders/useRiderStore';
import RatingNews from '../../components/riders/RatingNews';
import { fetchRiderNews, markNewsSeen, fetchRiderOrders } from '../../api/riders/riderApi';
import { useRiderLocation } from '../../hooks/common/useRiderLocation';
import { playSfx } from '../../utils/common/sfx';
import { acceptOrder, rejectOrder } from '../../api/riders/riderApi';
import { T, rupee, rupeeAmount, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';
import { useRiderDesktop } from '../../utils/common/layout';
import { Hero, GlassStat } from '../../components/owners/RiderDesk';

const POLL_MS = 6000;
const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

const secondsLeft = (o) => {
    const t = o.delivery?.offerExpiresAt;
    return t ? Math.max(0, Math.round((new Date(t).getTime() - Date.now()) / 1000)) : null;
};

// what he has to do next on a delivery he carries
const nextStep = (o) => (o.delivery?.status === 'accepted' ? T.collectTitle : o.delivery?.arrivedAt ? T.deliver : T.stepGo);

// A new order for him. Big numbers: what he earns, how far, what to collect. Accept is the only big button.
function OfferCard({ o, busy, onAccept, onReject, onExpire }) {
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, surface } = useBrand();
    const [left, setLeft] = useState(secondsLeft(o));
    useEffect(() => {
        const id = setInterval(() => {
            const n = secondsLeft(o);
            setLeft(n);
            if (n === 0) { clearInterval(id); onExpire(); }
        }, 1000);
        return () => clearInterval(id);
    }, [o]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (left === 0) return null;
    const cash = o.payment?.collectAmount > 0;
    return (
        <GlowBorder active radius={22} colors={[primaryLight, '#FFB703', primaryDark]} style={{ marginHorizontal: 16, marginBottom: 14 }}>
        <View style={{ borderRadius: 22, backgroundColor: surface, overflow: 'hidden' }}>
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 11 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="flash" size={18} color={onPrimary} />
                    <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 15, marginLeft: 6 }}>{T.newOrder} · {o.ref || '#' + o.orderNo}</Text>
                </View>
                {left != null ? <Text style={{ color: left <= 10 ? '#FFE0E0' : onPrimary, fontWeight: '900', fontSize: 14 }}>{T.secondsLeft(left)}</Text> : null}
            </LinearGradient>
            <View style={{ padding: 16, paddingTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 12 }}>
                {o.earnPaise > 0 ? (
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{T.youEarn('')}</Text>
                        <Text style={{ color: text, fontSize: 34, fontWeight: '900' }}>{rupee(o.earnPaise)}</Text>
                    </View>
                ) : null}
                {o.distanceKm != null ? (
                    <View style={{ flex: 1, alignItems: o.earnPaise > 0 ? 'flex-end' : 'flex-start' }}>
                        <Text style={{ color: text, fontSize: 26, fontWeight: '900' }}>{tr('{distanceKm} km', { distanceKm: o.distanceKm })}</Text>
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{T.away('').trim()}</Text>
                    </View>
                ) : null}
            </View>
            <Text style={{ color: muted, fontSize: 13, fontWeight: '600', marginTop: 10 }} numberOfLines={1}>
                {[o.address?.landmark, o.address?.city].filter(Boolean).join(', ') || ''}
            </Text>
            <View style={{ marginTop: 10 }}>
                <Banner tone={cash ? 'warn' : 'ok'} style={{ marginHorizontal: 0, marginBottom: 0 }} text={cash ? T.collectCash(rupeeAmount(o.payment.collectAmount)) : T.paidOnline} />
            </View>
            <View style={{ marginTop: 12 }}>
                <BigButton label={T.accept} icon="checkmark" onPress={onAccept} busy={busy} />
            </View>
            <SmallLink label={T.noThanks} onPress={onReject} />
            </View>
        </View>
        </GlowBorder>
    );
}

// The delivery he is carrying: a bold coloured card with the next thing to do. Tap anywhere to continue the trip.
function ActiveCard({ o, onPress }) {
    const { primaryLight, primaryDark, onPrimary } = useBrand();
    const cash = o.payment?.collectAmount > 0;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => [{ marginHorizontal: 16, marginBottom: 14 }, pressed && { opacity: 0.85 }]}>
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 16, elevation: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 }}>
                        <Ionicons name="bicycle" size={15} color={onPrimary} />
                        <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 12, marginLeft: 5 }}>{tr('ON A DELIVERY')}</Text>
                    </View>
                    <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 15 }}>{tr('Order #{orderNo}', { orderNo: o.ref || o.orderNo })}</Text>
                </View>
                <Text style={{ color: onPrimary, fontSize: 24, fontWeight: '900', marginTop: 14 }} numberOfLines={2}>{nextStep(o)}</Text>
                {cash ? <Text style={{ color: onPrimary, opacity: 0.92, fontSize: 14, fontWeight: '800', marginTop: 4 }}>{T.collectCash(rupeeAmount(o.payment.collectAmount))}</Text> : null}
                <View style={{ marginTop: 14, backgroundColor: '#FFFFFF', borderRadius: 14, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: primaryDark, fontWeight: '900', fontSize: 16 }}>{tr('Continue')}</Text>
                    <Ionicons name="arrow-forward" size={18} color={primaryDark} style={{ marginLeft: 6 }} />
                </View>
            </LinearGradient>
        </Pressable>
    );
}

export default function RiderHomeScreen() {
    const insets = useSafeAreaInsets();
    const nav = useNavigation();
    const desk = useRiderDesktop();   // a computer: a banner with the numbers, what needs him now on the left, duty and recent activity on the right
    const { background, text, muted, ok, error: bad, border, surface, primary } = useBrand();
    const { me, offers, active, summary, ready, error, load, setDuty } = useRiderStore();
    const [refreshing, setRefreshing] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [dutyBusy, setDutyBusy] = useState(false);
    const [askOff, setAskOff] = useState(false);   // "for how long?" when he ends duty
    const [guide, setGuide] = useState(false);   // "keep the app working", shown once
    // ratings customers gave him: read when he is free (after a delivery), shown on top until he closes it
    const [news, setNews] = useState(null);
    useEffect(() => {
        if (active.length > 0) return;
        let dead = false;
        fetchRiderNews().then((n) => { if (!dead) setNews(n?.items?.length ? n : null); }).catch(() => { });
        return () => { dead = true; };
    }, [active.length, summary]);   // eslint-disable-line react-hooks/exhaustive-deps
    const closeNews = () => { setNews(null); markNewsSeen().catch(() => { }); };

    // his last five deliveries, shown at the bottom so the page is never empty
    const [recent, setRecent] = useState([]);
    useEffect(() => {
        let dead = false;
        fetchRiderOrders('history', 1).then((r) => { if (!dead) setRecent((r.items || []).slice(0, 5)); }).catch(() => { });
        return () => { dead = true; };
    }, [active.length, summary]);

    useEffect(() => { useRiderStore.getState().hydrate(); }, []);   // the page opens at once with what it showed last time

    // new offers arrive while the page is open
    useFocusEffect(useCallback(() => {
        load();
        const id = setInterval(load, POLL_MS);
        const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => { clearInterval(id); sub.remove(); };
    }, [load]));

    // the phone shares its position while he carries an order (the customer sees the bike)
    useRiderLocation(active.length > 0);

    // the shop's closing time came and he has no delivery left: the switch shows OFF (the server also puts him off duty at once)
    const shopClosed = !!me?.shopClosed && !(me?.activeOrderCount > 0);
    const onDuty = !!me?.isOnline && !shopClosed;
    const changeDuty = async (v, extra) => {
        if (v && shopClosed) { showToast(tr('The shop is closed. You can start duty when it opens.')); return; }
        if (!v && !extra) {
            if (active.length > 0 || offers.length > 0) {
                const yes = await ask({ title: T.endDuty + '?', message: active.length ? tr('You still have a delivery to finish. You will get no new orders.') : tr('You will get no new orders.'), confirmText: T.endDuty });
                if (!yes) return;
            }
            setAskOff(true);   // then: for how long?
            return;
        }
        setDutyBusy(true);
        try {
            await setDuty(v, extra);
            if (v) {   // the first time he starts duty: how to stop the phone from killing the app
                const seen = await AsyncStorage.getItem('rider_keep_running_seen').catch(() => '1');
                if (!seen && Platform.OS !== 'web') { setGuide(true);   // the website has no app to keep running: no guide there
                AsyncStorage.setItem('rider_keep_running_seen', '1').catch(() => { }); }
            }
        } catch (e) { showToast(errText(e)); }
        setDutyBusy(false);
    };

    const accept = async (o) => {
        setBusyId(o.id);
        try {
            await acceptOrder(o.id);
            playSfx('riderAccept');
            await load();
            nav.navigate('RiderTrip', { orderId: String(o.id) });
        } catch (e) {
            showToast(e?.response?.status === 409 ? T.taken : errText(e));
            load();
        }
        setBusyId(null);
    };
    const reject = async (o) => {
        setBusyId(o.id);
        try { await rejectOrder(o.id); playSfx('riderReject'); } catch (e) { showToast(errText(e)); }
        setBusyId(null);
        load();
    };

    const liveOffers = offers.filter((o) => { const n = secondsLeft(o); return n === null || n > 0; });
    const earnedToday = summary?.earnings?.todayPaise || 0;
    const payType = summary?.pay?.type;
    const payTracked = !!payType && !['none', 'salary'].includes(payType);   // earnings per delivery exist only for those plans
    const cashHeld = summary?.cash?.owedToShopPaise || 0;
    const cashLimit = summary?.cash?.limitPaise || 0;
    const cashFull = cashLimit > 0 && cashHeld >= cashLimit;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <ScrollView
                contentContainerStyle={{ paddingTop: desk ? 8 : insets.top + 12, paddingBottom: 24, flexGrow: 1 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
            >
              <View style={desk ? { width: '100%', maxWidth: 1180, alignSelf: 'center' } : undefined}>
                {desk ? (
                    <Hero lead={<View style={{ marginRight: 16 }}><Avatar uri={me?.photo} size={64} /></View>} title={T.hello(me?.name?.split(' ')[0])} subtitle={me?.shop || ''}
                        right={(
                            <View style={{ flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 8, borderRadius: 23, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
                                <LiveToggle on={onDuty} busy={dutyBusy} onPress={() => changeDuty(!onDuty)} />
                                <BellButton />
                            </View>
                        )}>
                        {summary ? (
                            <View style={{ flexDirection: 'row', marginTop: 18 }}>
                                <GlassStat label={T.deliveriesToday} value={String(summary.deliveries?.today || 0)} icon="checkmark-done-outline" />
                                {payTracked ? <GlassStat label={T.earnedToday} value={rupee(earnedToday)} icon="cash-outline" /> : null}
                                {cashHeld > 0 ? <GlassStat label={tr('Cash held')} value={rupee(cashHeld)} icon="wallet-outline" /> : null}
                            </View>
                        ) : null}
                    </Hero>
                ) : null}
                {desk ? null : <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
                    <Avatar uri={me?.photo} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 20, fontWeight: '900' }}>{T.hello(me?.name?.split(' ')[0])}</Text>
                        <Text style={{ color: muted, fontSize: 13, fontWeight: '600' }}>{me?.shop || ''}</Text>
                    </View>
                    <LiveToggle on={onDuty} busy={dutyBusy} onPress={() => changeDuty(!onDuty)} />
                    <BellButton />
                </View>}

                {!ready && !error ? <ListShimmer count={3} /> : null}
                {error ? (
                    <View style={{ alignItems: 'center', padding: 30 }}>
                        <Ionicons name="cloud-offline-outline" size={44} color={muted} />
                        <Text style={{ color: text, fontWeight: '800', fontSize: 16, marginTop: 10 }}>{T.noNetwork}</Text>
                        <View style={{ marginTop: 16, alignSelf: 'stretch' }}><BigButton label={tr('Try again')} onPress={load} /></View>
                    </View>
                ) : null}

                {ready && !desk ? (
                    <>
                        {/* the ratings he got, only while he is free (not carrying an order) */}
                        {active.length === 0 ? <RatingNews news={news} onClose={closeNews} /> : null}
                        {/* what needs him now comes first: a new order to accept, then the deliveries he carries */}
                        {liveOffers.map((o) => (
                            <OfferCard key={String(o.id)} o={o} busy={busyId === o.id} onAccept={() => accept(o)} onReject={() => reject(o)} onExpire={load} />
                        ))}
                        {active.map((o) => (
                            <ActiveCard key={String(o.id)} o={o} onPress={() => nav.navigate('RiderTrip', { orderId: String(o.id) })} />
                        ))}

                        {/* duty */}
                        <View style={{ marginHorizontal: 16, marginBottom: 14, borderRadius: 22, padding: 16, backgroundColor: onDuty ? alpha(ok, 0.14) : surface, borderWidth: 1, borderColor: onDuty ? alpha(ok, 0.5) : border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 0 }}>
                                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: onDuty ? ok : muted, marginRight: 10 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{onDuty ? T.onDuty : T.offDuty}</Text>
                                    <Text style={{ color: muted, fontSize: 13, fontWeight: '600' }}>{onDuty ? T.onDutyHint(me?.shop) : T.offDutyHint}</Text>
                                </View>
                            </View>
                        </View>

                        {summary ? (
                            <Card>
                                <View style={{ flexDirection: 'row' }}>
                                    <Stat label={T.deliveriesToday} value={String(summary.deliveries?.today || 0)} />
                                    {payTracked ? <Stat label={T.earnedToday} value={rupee(earnedToday)} /> : null}
                                </View>
                                {cashHeld > 0 ? <Text style={{ color: '#B45309', fontWeight: '800', fontSize: 13, marginTop: 10 }}>{T.cashHeld(rupee(cashHeld))}</Text> : null}
                                {cashFull ? <Text style={{ color: '#DC2626', fontWeight: '900', fontSize: 13, marginTop: 6 }}>{T.cashOverLimit}</Text> : null}
                            </Card>
                        ) : null}

                        {onDuty && liveOffers.length === 0 && active.length === 0 ? (
                            <View style={{ alignItems: 'center', padding: 36 }}>
                                <Ionicons name="bicycle-outline" size={52} color={muted} />
                                <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 10 }}>{T.waiting}</Text>
                                <Text style={{ color: muted, fontWeight: '600', marginTop: 4, textAlign: 'center' }}>{T.waitingHint}</Text>
                            </View>
                        ) : null}
                        {recent.length ? (
                            <>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16, paddingHorizontal: 16, marginTop: 6, marginBottom: 8 }}>{tr('Recent activity')}</Text>
                                {recent.map((o) => {
                                    const done = o.status === 'delivered';
                                    return (
                                        <View key={String(o.id)} style={{ marginHorizontal: 16, marginBottom: 10, borderRadius: 16, padding: 14, backgroundColor: surface, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center' }}>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('Order #{orderNo}', { orderNo: o.ref || o.orderNo })}</Text>
                                                <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5, marginTop: 2 }}>{when(o.delivery?.deliveredAt || o.createdAt)}</Text>
                                            </View>
                                            <View style={{ alignItems: 'flex-end' }}>
                                                <Text style={{ color: done ? ok : bad, fontWeight: '900', fontSize: 14 }}>{done ? tr('Delivered') : o.status === 'cancelled' ? tr('Cancelled') : tr('Not delivered')}</Text>
                                                {done && o.earnPaise > 0 ? <Text style={{ color: text, fontWeight: '800', fontSize: 13, marginTop: 2 }}>{rupee(o.earnPaise)}</Text> : null}
                                            </View>
                                        </View>
                                    );
                                })}
                            </>
                        ) : null}
                    </>
                ) : null}
                {ready && desk ? (
                    <View>
                        {/* the duty strip: who he is right now, and the one button that changes it */}
                        <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 24, paddingVertical: 20, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', backgroundColor: onDuty ? alpha(ok, 0.12) : surface, borderWidth: 1, borderColor: onDuty ? alpha(ok, 0.45) : border }}>
                            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: onDuty ? alpha(ok, 0.2) : alpha(muted, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: onDuty ? ok : muted, boxShadow: onDuty ? `0 0 0 6px ${alpha(ok, 0.25)}` : 'none' }} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, marginLeft: 16 }}>
                                <Text style={{ color: text, fontSize: 21, fontWeight: '900' }}>{onDuty ? T.onDuty : T.offDuty}</Text>
                                <Text style={{ color: muted, fontSize: 14, fontWeight: '600', marginTop: 3 }}>{onDuty ? T.onDutyHint(me?.shop) : T.offDutyHint}</Text>
                            </View>
                            <View style={{ width: 190 }}>
                                <BigButton label={onDuty ? T.endDuty : T.startDuty} icon={onDuty ? 'power' : 'play'} kind={onDuty ? 'outline' : 'primary'} busy={dutyBusy} onPress={() => changeDuty(!onDuty)} />
                            </View>
                        </View>

                        <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                            {/* what needs him now */}
                            <View style={{ flex: 1, minWidth: 0, marginLeft: 16, marginRight: 8 }}>
                                <View style={{ borderRadius: 24, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingVertical: 18, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 }}>
                                        <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="flash" size={19} color={primary} /></View>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginLeft: 12, flex: 1 }}>{tr('Needs you now')}</Text>
                                    </View>
                                    {active.length === 0 ? <RatingNews news={news} onClose={closeNews} /> : null}
                                    {liveOffers.map((o) => (
                                        <OfferCard key={String(o.id)} o={o} busy={busyId === o.id} onAccept={() => accept(o)} onReject={() => reject(o)} onExpire={load} />
                                    ))}
                                    {active.map((o) => (
                                        <ActiveCard key={String(o.id)} o={o} onPress={() => nav.navigate('RiderTrip', { orderId: String(o.id) })} />
                                    ))}
                                    {liveOffers.length === 0 && active.length === 0 ? (
                                        <View style={{ alignItems: 'center', paddingVertical: 34, paddingHorizontal: 24 }}>
                                            <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: alpha(onDuty ? ok : muted, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                                                <Ionicons name={onDuty ? 'bicycle' : 'moon-outline'} size={44} color={onDuty ? ok : muted} />
                                            </View>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 16, textAlign: 'center' }}>{onDuty ? T.waiting : T.offDuty}</Text>
                                            <Text style={{ color: muted, fontWeight: '600', marginTop: 6, textAlign: 'center', maxWidth: 320, lineHeight: 20 }}>{onDuty ? T.waitingHint : T.offDutyHint}</Text>
                                        </View>
                                    ) : null}
                                </View>
                            </View>

                            {/* what he did lately */}
                            <View style={{ flex: 1, minWidth: 0, marginRight: 16, marginLeft: 8 }}>
                                <View style={{ borderRadius: 24, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingVertical: 18, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 }}>
                                        <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(ok, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="time" size={19} color={ok} /></View>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginLeft: 12, flex: 1 }}>{tr('Recent activity')}</Text>
                                    </View>
                                    {recent.length ? recent.map((o, i) => {
                                        const done = o.status === 'delivered';
                                        const tone = done ? ok : bad;
                                        return (
                                            <View key={String(o.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20, borderTopWidth: i ? 1 : 0, borderTopColor: alpha(border, 0.8) }}>
                                                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(tone, 0.13), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                                    <Ionicons name={done ? 'checkmark' : 'close'} size={20} color={tone} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 0 }}>
                                                    <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('Order #{orderNo}', { orderNo: o.ref || o.orderNo })}</Text>
                                                    <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5, marginTop: 2 }}>{when(o.delivery?.deliveredAt || o.createdAt)}</Text>
                                                </View>
                                                <View style={{ alignItems: 'flex-end' }}>
                                                    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 11, backgroundColor: alpha(tone, 0.13) }}>
                                                        <Text style={{ color: tone, fontWeight: '900', fontSize: 12 }}>{done ? tr('Delivered') : o.status === 'cancelled' ? tr('Cancelled') : tr('Not delivered')}</Text>
                                                    </View>
                                                    {done && o.earnPaise > 0 ? <Text style={{ color: text, fontWeight: '900', fontSize: 15, marginTop: 4 }}>{rupee(o.earnPaise)}</Text> : null}
                                                </View>
                                            </View>
                                        );
                                    }) : (
                                        <View style={{ alignItems: 'center', paddingVertical: 34, paddingHorizontal: 24 }}>
                                            <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: alpha(muted, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="receipt-outline" size={42} color={muted} /></View>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 16 }}>{tr('Nothing yet')}</Text>
                                            <Text style={{ color: muted, fontWeight: '600', marginTop: 6, textAlign: 'center' }}>{tr('Your deliveries will show here.')}</Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                        </View>
                    </View>
                ) : null}
              </View>
            </ScrollView>
            <KeepRunningSheet visible={guide} onClose={() => setGuide(false)} />
            <OffDutySheet visible={askOff} onClose={() => setAskOff(false)} onPick={(extra) => changeDuty(false, extra)} />
        </View>
    );
}
