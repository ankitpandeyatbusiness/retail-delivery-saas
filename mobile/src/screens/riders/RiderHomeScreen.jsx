// The rider's Home: one page. Start or end duty, the new order waiting for him (if any), and the deliveries he is carrying.
// Nothing else. A rider glances at this between stops, so it shows only what needs a decision.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, AppState, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { Card, Stat } from '../../components/owners/ui';
import { BigButton, SmallLink, Banner, Avatar } from '../../components/riders/riderBits';
import KeepRunningSheet from '../../components/riders/KeepRunningSheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRiderStore } from '../../store/riders/useRiderStore';
import { useRiderLocation } from '../../hooks/common/useRiderLocation';
import { acceptOrder, rejectOrder } from '../../api/riders/riderApi';
import { T, rupee, rupeeAmount, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';

const POLL_MS = 6000;

const secondsLeft = (o) => {
    const t = o.delivery?.offerExpiresAt;
    return t ? Math.max(0, Math.round((new Date(t).getTime() - Date.now()) / 1000)) : null;
};

// what he has to do next on a delivery he carries
const nextStep = (o) => (o.delivery?.status === 'accepted' ? T.collectTitle : o.delivery?.arrivedAt ? T.deliver : T.stepGo);

// A new order for him. Big numbers: what he earns, how far, what to collect. Accept is the only big button.
function OfferCard({ o, busy, onAccept, onReject, onExpire }) {
    const { primary, text, muted, surface } = useBrand();
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
        <View style={{ marginHorizontal: 16, marginBottom: 14, borderRadius: 22, borderWidth: 2, borderColor: primary, backgroundColor: surface, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: primary, fontWeight: '900', fontSize: 15 }}>{T.newOrder} · #{o.orderNo}</Text>
                {left != null ? <Text style={{ color: left <= 10 ? '#DC2626' : muted, fontWeight: '900', fontSize: 14 }}>{T.secondsLeft(left)}</Text> : null}
            </View>
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
    );
}

export default function RiderHomeScreen() {
    const insets = useSafeAreaInsets();
    const nav = useNavigation();
    const { background, text, muted, ok, border, surface } = useBrand();
    const { me, offers, active, summary, ready, error, load, setDuty } = useRiderStore();
    const [refreshing, setRefreshing] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [dutyBusy, setDutyBusy] = useState(false);
    const [guide, setGuide] = useState(false);   // "keep the app working", shown once

    // new offers arrive while the page is open
    useFocusEffect(useCallback(() => {
        load();
        const id = setInterval(load, POLL_MS);
        const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        return () => { clearInterval(id); sub.remove(); };
    }, [load]));

    // the phone shares its position while he carries an order (the customer sees the bike)
    useRiderLocation(active.length > 0);

    const onDuty = !!me?.isOnline;
    const changeDuty = async (v) => {
        if (!v && (active.length > 0 || offers.length > 0)) {
            const yes = await ask({ title: T.endDuty + '?', message: active.length ? tr('You still have a delivery to finish. You will get no new orders.') : tr('You will get no new orders.'), confirmText: T.endDuty });
            if (!yes) return;
        }
        setDutyBusy(true);
        try {
            await setDuty(v);
            if (v) {   // the first time he starts duty: how to stop the phone from killing the app
                const seen = await AsyncStorage.getItem('rider_keep_running_seen').catch(() => '1');
                if (!seen) { setGuide(true); AsyncStorage.setItem('rider_keep_running_seen', '1').catch(() => { }); }
            }
        } catch (e) { showToast(errText(e)); }
        setDutyBusy(false);
    };

    const accept = async (o) => {
        setBusyId(o.id);
        try {
            await acceptOrder(o.id);
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
        try { await rejectOrder(o.id); } catch (e) { showToast(errText(e)); }
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
                contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 130, flexGrow: 1 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 }}>
                    <Avatar uri={me?.photo} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 20, fontWeight: '900' }}>{T.hello(me?.name?.split(' ')[0])}</Text>
                        <Text style={{ color: muted, fontSize: 13, fontWeight: '600' }}>{me?.shop || ''}</Text>
                    </View>
                </View>

                {!ready && !error ? <View style={{ padding: 40 }}><ActivityIndicator /></View> : null}
                {error ? (
                    <View style={{ alignItems: 'center', padding: 30 }}>
                        <Ionicons name="cloud-offline-outline" size={44} color={muted} />
                        <Text style={{ color: text, fontWeight: '800', fontSize: 16, marginTop: 10 }}>{T.noNetwork}</Text>
                        <View style={{ marginTop: 16, alignSelf: 'stretch' }}><BigButton label={tr('Try again')} onPress={load} /></View>
                    </View>
                ) : null}

                {ready ? (
                    <>
                        {/* duty */}
                        <View style={{ marginHorizontal: 16, marginBottom: 14, borderRadius: 22, padding: 16, backgroundColor: onDuty ? alpha(ok, 0.14) : surface, borderWidth: 1, borderColor: onDuty ? alpha(ok, 0.5) : border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: onDuty ? 0 : 14 }}>
                                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: onDuty ? ok : muted, marginRight: 10 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{onDuty ? T.onDuty : T.offDuty}</Text>
                                    <Text style={{ color: muted, fontSize: 13, fontWeight: '600' }}>{onDuty ? T.onDutyHint(me?.shop) : T.offDutyHint}</Text>
                                </View>
                                {onDuty ? <SmallLink label={T.endDuty} onPress={() => changeDuty(false)} danger /> : null}
                            </View>
                            {!onDuty ? <BigButton label={T.startDuty} icon="power" onPress={() => changeDuty(true)} busy={dutyBusy} /> : null}
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

                        {/* a new order */}
                        {onDuty ? liveOffers.map((o) => (
                            <OfferCard key={String(o.id)} o={o} busy={busyId === o.id} onAccept={() => accept(o)} onReject={() => reject(o)} onExpire={load} />
                        )) : null}

                        {/* what he carries */}
                        {active.length > 0 ? (
                            <>
                                <Text style={{ color: text, fontSize: 16, fontWeight: '900', marginHorizontal: 16, marginBottom: 10 }}>{T.yourDeliveries}</Text>
                                {active.map((o) => {
                                    const cash = o.payment?.collectAmount > 0;
                                    return (
                                        <Pressable
                                            key={String(o.id)}
                                            onPress={() => nav.navigate('RiderTrip', { orderId: String(o.id) })}
                                            style={({ pressed }) => [{ marginHorizontal: 16, marginBottom: 10, borderRadius: 18, padding: 14, backgroundColor: surface, borderWidth: 1, borderColor: border, flexDirection: 'row', alignItems: 'center' }, pressed && { opacity: 0.75 }]}
                                        >
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Order #{orderNo}', { orderNo: o.orderNo })}</Text>
                                                <Text style={{ color: muted, fontWeight: '700', fontSize: 13, marginTop: 2 }}>{nextStep(o)}{cash ? ` · ${T.collectCash(rupeeAmount(o.payment.collectAmount))}` : ''}</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={22} color={muted} />
                                        </Pressable>
                                    );
                                })}
                            </>
                        ) : null}

                        {onDuty && liveOffers.length === 0 && active.length === 0 ? (
                            <View style={{ alignItems: 'center', padding: 36 }}>
                                <Ionicons name="bicycle-outline" size={52} color={muted} />
                                <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 10 }}>{T.waiting}</Text>
                                <Text style={{ color: muted, fontWeight: '600', marginTop: 4, textAlign: 'center' }}>{T.waitingHint}</Text>
                            </View>
                        ) : null}
                    </>
                ) : null}
            </ScrollView>
            <KeepRunningSheet visible={guide} onClose={() => setGuide(false)} />
        </View>
    );
}
