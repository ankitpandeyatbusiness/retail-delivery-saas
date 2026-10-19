// The owner's live map: the shop, every rider as a scooter, and every delivery on the way as a coloured route to the customer's pin.
//   - each delivery has ITS OWN colour: the rider's scooter (box and helmet), the route line, and the customer's pin with the order
//     number all share it, so the owner can tell which rider goes to which customer at a glance
//   - where two routes use the same road they are drawn at different widths, so both colours stay visible instead of one hiding the other
//   - the route starts at the rider (the road behind him is cut away) and the scooter slides along the road between the 10 second updates
//   - tap a rider or a customer: a card with his details (call, order, time left or late, the customer's address, what to collect)
// Everything comes from one call (GET /shop/live-map) every 10 seconds while the screen is open.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, Pressable, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Button, money } from '../../components/owners/ui';
import { callPhone } from '../../components/owners/orderBits';
import RiderTrack from '../../components/common/RiderTrack';
import HomePin from '../../components/common/HomePin';
import { useMapStyle } from '../../utils/common/mapStyle';
import { decodePolyline } from '../../utils/common/polyline';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { fetchLiveMap } from '../../api/owners/shopApi';
import { ago } from '../../utils/owners/riderRules';
import { tr } from '../../i18n';

// one colour per delivery; a colour is kept for the whole delivery (see colourOf)
const COLOURS = ['#E53935', '#1E88E5', '#43A047', '#8E24AA', '#FB8C00', '#00897B', '#D81B60', '#3949AB'];
const WIDTHS = [9, 6, 4, 3];           // stacked: the first delivery is the widest and lowest, the next ones sit inside it
const IDLE = '#6B7280';                // a rider with no delivery

const minsLeft = (t, now) => {
    if (!t?.dueAt) return null;
    const m = Math.round((new Date(t.dueAt).getTime() - now) / 60000);
    return m >= 0 ? { late: false, text: tr('{n} min left', { n: Math.max(1, m) }) } : { late: true, text: tr('Late by {n} min', { n: -m }) };
};
// the shop, the riders that have a position and the customers: what "show everything" frames
const pointsOf = (r) => [
    r?.shop && { latitude: r.shop.lat, longitude: r.shop.lng },
    ...(r?.riders || []).filter((x) => x.lat != null).map((x) => ({ latitude: x.lat, longitude: x.lng })),
    ...(r?.trips || []).filter((t) => t.dest).map((t) => ({ latitude: t.dest.lat, longitude: t.dest.lng })),
].filter(Boolean);

const etaMin = (t, now) => (t?.etaAt ? Math.max(1, Math.ceil((new Date(t.etaAt).getTime() - now) / 60000)) : null);

/* ------------------------------ one delivery on the map ------------------------------ */
function TripLayer({ trip, rider, color, index, focusKey, onRider, onCustomer }) {
    const road = useMemo(() => (trip.route?.source === 'google' && trip.route.polyline ? decodePolyline(trip.route.polyline) : []), [trip.route?.source, trip.route?.polyline]);
    const [settle, setSettle] = useState(true);   // the pin is a custom view: drawn again for a moment when it appears
    useEffect(() => { setSettle(true); const t = setTimeout(() => setSettle(false), 1500); return () => clearTimeout(t); }, [color, trip.orderNo, focusKey]);
    const dest = trip.dest ? { latitude: trip.dest.lat, longitude: trip.dest.lng } : null;
    const loc = rider && rider.lat != null ? { lat: rider.lat, lng: rider.lng } : null;
    return (
        <>
            <RiderTrack
                road={road} loc={loc} dest={dest} orderId={trip.orderId} color={color} estimate={trip.route?.source !== 'google'}
                lineWidth={WIDTHS[Math.min(index, WIDTHS.length - 1)]} casing={index === 0 ? 3 : 0} zIndex={index + 1}
                refreshKey={focusKey}
                onPress={(e) => { e?.stopPropagation?.(); if (rider) onRider(rider.riderId); }}
            />
            {dest ? (
                <Marker coordinate={dest} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={settle} onPress={(e) => { e?.stopPropagation?.(); onCustomer(trip.orderId); }} zIndex={5}>
                    <HomePin color={color} size={30} label={`#${trip.orderNo}`} />
                </Marker>
            ) : null}
        </>
    );
}

/* ------------------------------ the details card ------------------------------ */
function Row({ icon, children, color }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
            <Ionicons name={icon} size={16} color={color || muted} style={{ marginTop: 1, marginRight: 8 }} />
            <Text style={{ color: color || text, fontSize: 13.5, fontWeight: '600', flex: 1 }}>{children}</Text>
        </View>
    );
}

function Details({ kind, rider, trip, colour, now, onClose, onOrder }) {
    const { text, muted, surface, border, error } = useBrand();
    const left = minsLeft(trip, now);
    const eta = etaMin(trip, now);
    return (
        <View style={[s.card, { backgroundColor: surface, borderColor: colour || border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[s.dot, { backgroundColor: colour || IDLE }]} />
                <Text style={{ color: text, fontSize: 17, fontWeight: '900', flex: 1 }} numberOfLines={1}>
                    {kind === 'rider' ? (rider?.name || tr('Rider')) : (trip?.customer?.name || tr('Customer'))}
                </Text>
                <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={tr('Close')}><Ionicons name="close" size={22} color={muted} /></Pressable>
            </View>

            {kind === 'rider' ? (
                <>
                    <Row icon="bicycle">{trip ? tr('On delivery · order #{orderNo}', { orderNo: trip.orderNo }) : (rider?.isOnline ? tr('Online, free') : tr('Offline'))}</Row>
                    {trip ? <Row icon="home-outline">{tr('To {name}, {area}', { name: trip.customer?.name || tr('the customer'), area: trip.address?.area || '' })}</Row> : null}
                    {left ? <Row icon={left.late ? 'alarm' : 'timer-outline'} color={left.late ? error : undefined}>{left.text}{eta ? ` · ${tr('arrives in about {n} min', { n: eta })}` : ''}</Row> : null}
                    {rider?.avgDeliveryMin ? <Row icon="time-outline">{tr('Usually delivers in about {n} min', { n: rider.avgDeliveryMin })}</Row> : null}
                    <Row icon="locate-outline" color={rider?.quiet ? error : undefined}>
                        {rider?.at ? (rider.quiet ? tr('No signal, last seen {when}', { when: ago(rider.at) }) : tr('Location updated {when}', { when: ago(rider.at) })) : tr('No position yet')}
                    </Row>
                </>
            ) : (
                <>
                    <Row icon="receipt-outline">{tr('Order #{orderNo}', { orderNo: trip?.orderNo })}{trip?.total != null ? ` · ${money(trip.total)}` : ''}</Row>
                    {trip?.address?.text ? <Row icon="location-outline">{trip.address.text}</Row> : null}
                    {trip?.collect > 0 ? <Row icon="cash-outline">{tr('Rider collects {amount} cash', { amount: money(trip.collect) })}</Row> : null}
                    <Row icon="bicycle">{tr('Rider: {name}', { name: trip?.riderName || tr('assigned') })}</Row>
                    {left ? <Row icon={left.late ? 'alarm' : 'timer-outline'} color={left.late ? error : undefined}>{left.text}{eta ? ` · ${tr('arrives in about {n} min', { n: eta })}` : ''}</Row> : null}
                </>
            )}

            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                {kind === 'rider' && rider?.phone ? <View style={{ flex: 1, marginRight: 8 }}><Button label={tr('Call rider')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(rider.phone)} /></View> : null}
                {kind === 'customer' && trip?.customer?.phone ? <View style={{ flex: 1, marginRight: 8 }}><Button label={tr('Call customer')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(trip.customer.phone)} /></View> : null}
                {trip ? <View style={{ flex: 1 }}><Button label={tr('Open order')} icon="open-outline" onPress={() => onOrder(trip.orderId)} /></View> : null}
            </View>
        </View>
    );
}

/* ------------------------------ the screen ------------------------------ */
export default function OwnerRiderMapScreen() {
    const { background, text, muted, surface, border, error, primary } = useBrand();
    const mapStyle = useMapStyle();
    const nav = useNavigation();
    const map = useRef(null);
    const fitted = useRef(false);
    const colours = useRef(new Map());   // orderId -> colour: a delivery keeps its colour while it lasts
    const [data, setData] = useState(null);
    const [sel, setSel] = useState(null);   // { kind: 'rider' | 'customer', id }
    const [now, setNow] = useState(Date.now());
    const [settle, setSettle] = useState(true);
    const [focusKey, setFocusKey] = useState(0);   // changes each time the screen comes back into view: the markers are drawn again

    const frame = (pts) => {
        if (!map.current || !pts.length) return;
        if (pts.length === 1) map.current.animateToRegion({ ...pts[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 300);
        else map.current.fitToCoordinates(pts, { edgePadding: { top: 120, right: 60, bottom: 280, left: 60 }, animated: true });
    };

    useFocusEffect(useCallback(() => {
        setFocusKey((k) => k + 1);
        let alive = true;
        const tick = async () => {
            try {
                const r = await fetchLiveMap();
                if (!alive) return;
                setData(r);
                setNow(Date.now());
                if (!fitted.current && map.current) {
                    const pts = pointsOf(r);
                    if (pts.length) {
                        fitted.current = true;
                        setTimeout(() => frame(pts), 300);
                    }
                }
            } catch (e) { useOwnerStore.getState().noteError(e); if (alive) setData((x) => x || { shop: null, riders: [], trips: [] }); }
        };
        tick();
        const id = setInterval(tick, 10000);
        const clock = setInterval(() => setNow(Date.now()), 15000);
        return () => { alive = false; clearInterval(id); clearInterval(clock); };
    }, []));
    useEffect(() => { setSettle(true); const t = setTimeout(() => setSettle(false), 1500); return () => clearTimeout(t); }, [focusKey]);

    const riders = data?.riders || [];
    const trips = data?.trips || [];

    // a colour per delivery, kept while it lasts; a finished delivery gives its colour back
    const colourOf = (orderId) => {
        const map2 = colours.current;
        if (!map2.has(orderId)) {
            const used = new Set(map2.values());
            map2.set(orderId, COLOURS.find((c) => !used.has(c)) || COLOURS[map2.size % COLOURS.length]);
        }
        return map2.get(orderId);
    };
    for (const id of [...colours.current.keys()]) if (!trips.some((t) => t.orderId === id)) colours.current.delete(id);
    const tripsOrdered = [...trips].sort((a, b) => String(a.orderId).localeCompare(String(b.orderId)));
    const riderById = new Map(riders.map((r) => [r.riderId, r]));
    const tripOfRider = (r) => trips.find((t) => t.riderId === r.riderId);

    const lateCount = trips.filter((t) => t.late).length;
    const onDelivery = riders.filter((r) => r.orderIds?.length).length;
    const noSignal = riders.filter((r) => r.quiet).length;

    const selRider = sel?.kind === 'rider' ? riderById.get(sel.id) : null;
    const selTrip = sel?.kind === 'customer' ? trips.find((t) => t.orderId === sel.id) : (selRider ? tripOfRider(selRider) : null);
    const selColour = selTrip ? colourOf(selTrip.orderId) : (selRider ? IDLE : null);

    const focus = (lat, lng) => map.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 400);
    const pickRider = (id) => { setSel({ kind: 'rider', id }); const r = riderById.get(id); if (r?.lat != null) focus(r.lat, r.lng); };
    const pickCustomer = (id) => setSel({ kind: 'customer', id });

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Live map')} />
            <View style={{ flex: 1 }}>
                <MapView
                    ref={map}
                    provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                    customMapStyle={mapStyle}
                    style={StyleSheet.absoluteFill}
                    initialRegion={{ latitude: 22.5, longitude: 79, latitudeDelta: 20, longitudeDelta: 20 }}
                    showsCompass={false} toolbarEnabled={false} rotateEnabled={false} pitchEnabled={false}
                    onPress={(e) => { if (e?.nativeEvent?.action === 'marker-press') return; setSel(null); }}
                >
                    {data?.shop ? (
                        <Marker key={`shop:${focusKey}`} coordinate={{ latitude: data.shop.lat, longitude: data.shop.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={settle} zIndex={3}>
                            <View style={s.shop}><Ionicons name="storefront" size={15} color="#FFFFFF" /></View>
                        </Marker>
                    ) : null}
                    {tripsOrdered.map((t, i) => (
                        <TripLayer
                            key={`${t.orderId}:${focusKey}`} trip={t} rider={riderById.get(t.riderId)} color={colourOf(t.orderId)} index={i} focusKey={focusKey}
                            onRider={pickRider} onCustomer={pickCustomer}
                        />
                    ))}
                    {/* riders with no delivery: a grey scooter */}
                    {riders.filter((r) => !r.orderIds?.length && r.lat != null).map((r) => (
                        <RiderTrack
                            key={`${r.riderId}:${focusKey}`} road={[]} loc={{ lat: r.lat, lng: r.lng }} dest={null} orderId={`idle-${r.riderId}`} color={IDLE}
                            lineWidth={0} casing={0} refreshKey={focusKey} onPress={(e) => { e?.stopPropagation?.(); pickRider(r.riderId); }}
                        />
                    ))}
                </MapView>

                {/* the numbers */}
                <View style={[s.chips, { top: 10 }]} pointerEvents="none">
                    <View style={[s.chip, { backgroundColor: surface, borderColor: border }]}><Text style={[s.chipT, { color: text }]}>{tr('{n} on delivery', { n: onDelivery })}</Text></View>
                    <View style={[s.chip, { backgroundColor: surface, borderColor: lateCount ? error : border }]}><Text style={[s.chipT, { color: lateCount ? error : text }]}>{lateCount ? tr('{n} late', { n: lateCount }) : tr('None late')}</Text></View>
                    {noSignal ? <View style={[s.chip, { backgroundColor: surface, borderColor: border }]}><Text style={[s.chipT, { color: muted }]}>{tr('{n} no signal', { n: noSignal })}</Text></View> : null}
                </View>
                <Pressable
                    onPress={() => frame(pointsOf(data))}
                    style={[s.fit, { backgroundColor: surface, borderColor: border }]} accessibilityLabel={tr('Show everything')}
                >
                    <Ionicons name="scan-outline" size={20} color={primary} />
                </Pressable>

                {data && !riders.length ? (
                    <View style={[s.empty, { backgroundColor: surface, borderColor: border }]}>
                        <Text style={{ color: text, fontWeight: '800' }}>{tr('No rider is online')}</Text>
                        <Text style={{ color: muted, marginTop: 2, fontSize: 12 }}>{tr('Riders show here while they are on duty.')}</Text>
                    </View>
                ) : null}

                {/* the card of the rider or customer that was tapped (nothing else sits at the bottom, so many riders never crowd the map) */}
                <View style={s.bottom} pointerEvents="box-none">
                    {sel && (selRider || selTrip) ? (
                        <Details kind={sel.kind} rider={selRider || riderById.get(selTrip?.riderId)} trip={selTrip} colour={selColour} now={now}
                            onClose={() => setSel(null)} onOrder={(id) => nav.navigate('OwnerOrder', { id: String(id) })} />
                    ) : null}
                </View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    shop: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF', elevation: 4 },
    chips: { position: 'absolute', left: 10, right: 60, flexDirection: 'row', flexWrap: 'wrap' },
    chip: { borderRadius: 14, borderWidth: 1, paddingVertical: 5, paddingHorizontal: 11, marginRight: 6, marginBottom: 6, elevation: 3 },
    chipT: { fontWeight: '800', fontSize: 12.5 },
    fit: { position: 'absolute', right: 10, top: 10, width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', elevation: 4 },
    empty: { position: 'absolute', left: 16, right: 16, top: 70, borderRadius: 14, borderWidth: 1, padding: 14, elevation: 3 },
    bottom: { position: 'absolute', left: 0, right: 0, bottom: 14 },
    dot: { width: 12, height: 12, borderRadius: 6, marginRight: 0 },
    card: { marginHorizontal: 12, borderRadius: 18, borderWidth: 2, padding: 14, elevation: 8 },
});
