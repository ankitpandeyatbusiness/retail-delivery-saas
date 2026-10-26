// The rider's page when an order has been delivered: a proud "Delivered!", what this trip paid, how long it took, and the cash he
// must give to the shop (if the customer paid in cash). Nothing here judges him: a slow trip is just a number.
import React, { useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { BigButton } from './riderBits';
import { T, rupee, rupeeAmount } from '../../utils/riders/riderText';
import { tr } from '../../i18n';

const mins = (a, b) => {
    const x = new Date(a).getTime();
    const y = new Date(b).getTime();
    return Number.isFinite(x) && Number.isFinite(y) && y > x ? Math.max(1, Math.round((y - x) / 60000)) : null;
};

function Stat({ icon, value, label, delay }) {
    const { surface, border, text, muted, primary } = useBrand();
    const v = useSharedValue(0);
    useEffect(() => { v.value = withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) })); }, [v, delay]);
    const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 14 }] }));
    return (
        <Reanimated.View style={[{ flex: 1, backgroundColor: surface, borderColor: border, borderWidth: 1, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' }, st]}>
            <Ionicons name={icon} size={20} color={primary} />
            <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
            <Text style={{ color: muted, fontSize: 12, fontWeight: '700', marginTop: 2 }}>{label}</Text>
        </Reanimated.View>
    );
}

export default function DeliveredView({ o, onDone }) {
    const { background, text, muted, ok, surface, border, warn } = useBrand();
    const insets = useSafeAreaInsets();
    const pop = useSharedValue(0);
    const ring = useSharedValue(0);
    useEffect(() => {
        pop.value = withSpring(1, { damping: 9, stiffness: 120 });
        ring.value = withRepeat(withSequence(withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 0 })), -1, false);
    }, [pop, ring]);
    const badge = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], opacity: pop.value }));
    const halo = useAnimatedStyle(() => ({ opacity: (1 - ring.value) * 0.35, transform: [{ scale: 1 + ring.value * 0.7 }] }));

    const d = o.delivery || {};
    const took = mins(d.collectedAt, d.deliveredAt);
    const onTime = took != null && d.plannedSec ? took * 60 <= d.plannedSec : null;
    const cash = o.payment?.method === 'cod' && !o.payment?.paidAtDoor ? Number(o.payment.collectAmount) || 0 : 0;
    const items = (o.items || []).reduce((n, i) => n + (i.quantity || 0), 0);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 36, paddingHorizontal: 20, paddingBottom: 24, alignItems: 'center' }} showsVerticalScrollIndicator={false}>
                <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}>
                    <Reanimated.View style={[{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: ok }, halo]} />
                    <Reanimated.View style={[{ width: 112, height: 112, borderRadius: 56, backgroundColor: ok, alignItems: 'center', justifyContent: 'center', elevation: 6 }, badge]}>
                        <Ionicons name="checkmark" size={68} color="#FFFFFF" />
                    </Reanimated.View>
                </View>
                <Text style={{ color: text, fontSize: 30, fontWeight: '900', marginTop: 18 }}>{T.delivered}</Text>
                <Text style={{ color: muted, fontSize: 14.5, fontWeight: '600', marginTop: 6, textAlign: 'center' }}>
                    {`#${o.orderNo}${o.customer?.name ? ` · ${o.customer.name}` : ''}${items ? ` · ${items} ${items === 1 ? tr('item') : tr('items')}` : ''}`}
                </Text>
                <Text style={{ color: muted, fontSize: 14, marginTop: 4 }}>{tr('Great work. Thank you!')}</Text>

                <View style={{ flexDirection: 'row', alignSelf: 'stretch', marginTop: 26 }}>
                    {o.earnPaise > 0 ? <Stat icon="wallet" value={rupee(o.earnPaise)} label={tr('You earned')} delay={150} /> : null}
                    {took != null ? <View style={{ width: o.earnPaise > 0 ? 10 : 0 }} /> : null}
                    {took != null ? <Stat icon="time" value={`${took} min`} label={tr('Trip time')} delay={250} /> : null}
                    {o.distanceKm != null ? <View style={{ width: 10 }} /> : null}
                    {o.distanceKm != null ? <Stat icon="navigate" value={`${o.distanceKm} km`} label={tr('Distance')} delay={350} /> : null}
                </View>

                {o.rating ? (
                    <View style={{ alignSelf: 'stretch', marginTop: 18, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 14 }}>
                        <Text style={{ color: muted, fontSize: 12.5, fontWeight: '800' }}>{tr('The customer rated this delivery')}</Text>
                        <View style={{ flexDirection: 'row', marginTop: 6 }}>
                            {[1, 2, 3, 4, 5].map((n) => <Ionicons key={n} name={n <= o.rating.stars ? 'star' : 'star-outline'} size={26} color={warn} style={{ marginRight: 2 }} />)}
                        </View>
                        {o.rating.tags?.length ? <Text style={{ color: text, fontWeight: '700', marginTop: 6 }}>{o.rating.tags.join(' · ')}</Text> : null}
                        {o.rating.comment ? <Text style={{ color: text, marginTop: 6, fontStyle: 'italic' }}>{`“${o.rating.comment}”`}</Text> : null}
                    </View>
                ) : null}

                {onTime === true ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: alpha(ok, 0.14) }}>
                        <Ionicons name="flash" size={16} color={ok} />
                        <Text style={{ color: ok, fontWeight: '900', marginLeft: 6 }}>{tr('Delivered on time')}</Text>
                    </View>
                ) : null}

                {cash > 0 ? (
                    <View style={{ alignSelf: 'stretch', marginTop: 18, borderRadius: 18, borderWidth: 1, borderColor: alpha(warn, 0.5), backgroundColor: alpha(warn, 0.1), padding: 14, flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="cash" size={26} color={warn} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Cash collected: {amount}', { amount: rupeeAmount(cash) })}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Give this money to the shop. It is on your cash list.')}</Text>
                        </View>
                    </View>
                ) : (o.payment?.method === 'cod' && o.payment?.paidAtDoor) || o.payment?.method !== 'cod' ? (
                    <View style={{ alignSelf: 'stretch', marginTop: 18, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="card" size={24} color={ok} />
                        <Text style={{ flex: 1, marginLeft: 12, color: text, fontWeight: '800' }}>{tr('Paid online. You have no cash to give.')}</Text>
                    </View>
                ) : null}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: border, backgroundColor: background }}>
                <BigButton label={T.backHome} onPress={onDone} />
            </View>
        </View>
    );
}
