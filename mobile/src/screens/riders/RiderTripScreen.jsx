// One delivery, one step at a time. The big button at the bottom is always the next thing to do:
//   1 Collect      "I have collected the order"
//   2 On the way   "I have arrived"           (Navigate and Call are right above)
//   3 Deliver      "Deliver"                  (PIN, or a photo, or the cash / QR when the customer pays at the door)
// Everything else (a problem, giving the order back) is a small link, never a second big button.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Linking, TextInput, ActivityIndicator, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useBrand, alpha } from '../../components/common/kit';
import { showToast } from '../../components/customers/shop';
import { themedAlert, ask } from '../../components/common/dialog';
import { Card, PageHeader, Sheet, Button } from '../../components/owners/ui';
import { PayQrSheet } from '../../components/owners/moneyBits';
import SosSheet from '../../components/riders/SosSheet';
import RiderMap from '../../components/riders/RiderMap';
import TripClock, { dueOf } from '../../components/riders/TripClock';
import { onOrderEta, onRiderRoute, watchOrder } from '../../api/common/socket';
import { BigButton, SmallLink, Banner, Steps } from '../../components/riders/riderBits';
import { useRiderStore } from '../../store/riders/useRiderStore';
import {
    fetchRiderOrder, fetchRoute, cancelDelivery, pickupOrder, markArrived, deliverOrder, reportProblem, releaseOrder, startDoorPay, checkDoorPay,
} from '../../api/riders/riderApi';
import { takeAndUploadProof } from '../../utils/riders/riderPhotos';
import { startRiderTracking } from '../../utils/riders/locationTask';
import LocationStatus from '../../components/riders/LocationStatus';
import { T, rupee, rupeeAmount, addressLine, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';

const POLL_MS = 5000;
const STEP_LABELS = [T.stepCollect, T.stepGo, T.stepDeliver];

// where he is right now (the server uses it to check he is near the customer). null when the phone cannot say.
async function currentSpot() {
    try {
        const p = await Location.getForegroundPermissionsAsync();
        if (!p.granted) return {};
        const pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise((r) => setTimeout(() => r(null), 6000)),
        ]);
        return pos?.coords ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : {};
    } catch (e) { return {}; }
}

export default function RiderTripScreen() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { orderId } = useRoute().params || {};
    const { background, text, muted, surface, border, ok, primary, error } = useBrand();
    const [o, setO] = useState(null);
    const [gone, setGone] = useState(false);
    const [busy, setBusy] = useState('');
    const [sheet, setSheet] = useState(null);   // 'pin' | 'problem'
    const [pin, setPin] = useState('');
    const [qr, setQr] = useState(null);
    const [offline, setOffline] = useState(false);   // the last ask for this order got no answer at all
    const [sosOpen, setSosOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');   // the reason picked in the cancel sheet
    const [cancelNote, setCancelNote] = useState('');
    const [mapTouch, setMapTouch] = useState(false);   // a finger is on the map: the page behind it must not scroll
    const [plan, setPlan] = useState(null);   // the road from the shop to the customer and the time allowed (the server keeps it per order)
    const [eta, setEta] = useState(null);     // the server's arrival estimate, from his location
    const [liveRoute, setLiveRoute] = useState(null);   // the server's road from where he is to the customer (after pickup)
    const shopPhone = useRiderStore((s) => s.me?.shopPhone);
    const shopName = useRiderStore((s) => s.me?.shop);
    const alive = useRef(true);

    // asks the server for the order. Returns it (or null). A failed ask with no answer at all means the phone has no network.
    const refresh = useCallback(async () => {
        try {
            const r = await fetchRiderOrder(orderId);
            if (alive.current) { setO(r); setOffline(false); }
            return r;
        } catch (e) {
            if (alive.current) {
                if (!e?.response) setOffline(true);
                else if (e.response.status === 404) setGone(true);
            }
            return null;
        }
    }, [orderId]);
    useEffect(() => {
        alive.current = true;
        refresh();
        const id = setInterval(refresh, POLL_MS);
        return () => { alive.current = false; clearInterval(id); };
    }, [refresh]);

    // the road and the time allowed: asked once; tried again after 30 seconds if it failed
    const accepted = ['accepted', 'picked_up'].includes(o?.delivery?.status);
    useEffect(() => {
        if (!accepted) return undefined;
        let dead = false;
        let timer;
        const go = async () => {
            try { const r = await fetchRoute(orderId); if (!dead) setPlan(r); } catch (e) { if (!dead && e?.response?.status !== 404 && e?.response?.status !== 409) timer = setTimeout(go, 30000); }
        };
        go();
        return () => { dead = true; clearTimeout(timer); };
    }, [orderId, accepted]);

    // on his way: the server's arrival estimate (it needs his location, which the background service sends)
    const onTheWay = o?.delivery?.status === 'picked_up';
    useEffect(() => {
        if (!onTheWay) return undefined;
        const leave = watchOrder(String(orderId));
        const mine = (p) => String(p?.orderId) === String(orderId);
        const offs = [onOrderEta((p) => { if (mine(p)) setEta(p); }), onRiderRoute((p) => { if (mine(p)) setLiveRoute(p); })];
        return () => { offs.forEach((f) => f()); leave(); };
    }, [orderId, onTheWay]);

    const sync = (r) => { if (r?.id) setO(r); useRiderStore.getState().load(); };
    // a step is tried again by itself for a while when there is no network; after any failure the order is read again, so
    // a step that DID reach the server (and only the answer got lost) shows up as done instead of as an error
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const retrying = async (fn) => {
        for (let i = 0; ; i += 1) {
            try { return await fn(); } catch (e) {
                if (e?.response || i >= 5 || !alive.current) throw e;
                if (i === 0) showToast(T.retrying);
                await wait(4000);
            }
        }
    };
    const run = async (key, fn) => {
        setBusy(key);
        try { return await fn(); } catch (e) { showToast(errText(e)); await refresh(); return null; } finally { setBusy(''); }
    };

    const d = o?.delivery || {};
    const finished = o && ['delivered', 'cancelled', 'undelivered'].includes(o.status);
    const step = d.status === 'accepted' ? 0 : d.arrivedAt ? 2 : 1;
    const cash = (o?.payment?.collectAmount || 0) > 0;
    const spot = o?.destination;
    // the due time (saved by the server when the food was collected; until it arrives, worked out here the same way) and the pin's text
    const due = step >= 1 ? dueOf({ dueAt: d.dueAt, collectedAt: d.collectedAt, allowedSec: d.plannedSec || plan?.allowedSec }) : null;
    const etaMin = eta?.etaAt ? Math.max(1, Math.ceil((new Date(eta.etaAt).getTime() - Date.now()) / 60000)) : null;   // tentative minutes to reach, from his location
    const secsLeft = due ? Math.round((due - Date.now()) / 1000) : null;
    const pinLabel = step === 0
        ? ((d.plannedSec || plan?.allowedSec) ? tr('~{min} min', { min: Math.round((d.plannedSec || plan.allowedSec) / 60) }) : null)
        : secsLeft == null ? null : secsLeft >= 0 ? tr('{min} min left', { min: Math.max(1, Math.ceil(secsLeft / 60)) }) : tr('Late');

    /* ---------- actions ---------- */
    // the journey starts: the order is marked collected (the customer is told), then Google Maps opens with the way to the customer.
    // His location keeps going to the customer from the background service while Google Maps is in front.
    // Collected: the trip is on. Make sure his location service runs (it may have stopped while he waited at the shop), so the customer sees him.
    const collect = () => run('collect', async () => {
        sync(await retrying(() => pickupOrder(orderId)));
        startRiderTracking().catch(() => { });   // never in the way of the delivery
        navigate();
    });
    const arrived = () => run('arrived', async () => sync(await retrying(() => markArrived(orderId))));
    const navigate = () => {
        const q = spot ? `${spot.latitude},${spot.longitude}` : encodeURIComponent(addressLine(o?.address));
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=two-wheeler`).catch(() => showToast(tr('Could not open Maps')));
    };
    const callCustomer = () => o?.customer?.phone && Linking.openURL(`tel:${o.customer.phone}`).catch(() => { });
    const callShop = () => shopPhone && Linking.openURL(`tel:${shopPhone}`).catch(() => { });

    const giveBack = async () => {
        const yes = await ask({ title: T.cannotDoTitle, message: T.cannotDoText, confirmText: T.giveBack, destructive: true });
        if (!yes) return;
        const r = await run('release', () => releaseOrder(orderId));
        if (r) { useRiderStore.getState().load(); nav.goBack(); }
    };

    const sendProblem = async (reason) => {
        setSheet(null);
        const r = await run('problem', () => reportProblem(orderId, reason));
        if (r) showToast(T.problemHint);
    };

    // He cannot finish this delivery (food collected): cancel it. The customer and the shop are told; the customer pays nothing.
    const doCancel = async () => {
        const yes = await ask({ title: tr('Cancel this order?'), message: tr('The customer and the shop will be told. You can not undo it.'), confirmText: tr('Cancel order'), destructive: true });
        if (!yes) return;
        const r = await run('cancel', () => cancelDelivery(orderId, cancelReason, cancelNote.trim() || undefined));
        if (r) {
            setSheet(null);
            showToast(tr('The order is cancelled. The shop and the customer are told.'));
            useRiderStore.getState().load();
            nav.goBack();
        }
    };

    // the delivery itself: photo (when the shop has no PIN), PIN, where he is, and "deliver anyway" when he is far
    const doDeliver = async (pinValue, farOk) => {
        setBusy('deliver');
        try {
            const here = await currentSpot();
            const r = await deliverOrder(orderId, pinValue, { ...here, ...(farOk ? { farOk: true } : {}) });
            setSheet(null);
            sync(r);
        } catch (e) {
            const body = e?.response?.data;
            if (body?.code === 'TOO_FAR') {
                setSheet(null);
                setBusy('');
                if (await ask({ title: T.farTitle, message: body.error, confirmText: T.farDeliver })) await doDeliver(pinValue, true);
                return;
            }
            // the delivery may have gone through and only the answer got lost: look before saying it failed
            const fresh = await refresh();
            if (fresh?.status === 'delivered') { setSheet(null); sync(fresh); return; }
            if (pinValue != null) setPin('');
            themedAlert(tr('Could not deliver'), errText(e));
        } finally { setBusy(''); }
    };
    const startDeliver = async () => {
        if (!d.pinRequired && !d.proof) {
            const take = await ask({ title: T.photoNeeded, message: T.photoNeededText, confirmText: T.takePhoto });
            if (!take) return;
            const ok2 = await run('photo', async () => { const r = await takeAndUploadProof(orderId); if (r) await refresh(); return !!r; });
            if (!ok2) return;
        }
        if (d.pinRequired) { setPin(''); setSheet('pin'); return; }
        await doDeliver(undefined, false);
    };
    const addPhoto = () => run('photo', async () => { const r = await takeAndUploadProof(orderId); if (r) { showToast(T.photoSaved); await refresh(); } });

    const payByQr = async () => {
        const r = await run('qr', () => startDoorPay(orderId));
        if (r?.qr) setQr(r.qr);
    };

    /* ---------- the page ---------- */
    if (gone) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Order')} />
                <View style={{ padding: 24 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 16 }}>{tr('This order is not yours any more.')}</Text>
                    <View style={{ marginTop: 16 }}><BigButton label={T.backHome} onPress={() => nav.goBack()} /></View>
                </View>
            </View>
        );
    }
    if (!o) return <View style={{ flex: 1, backgroundColor: background, justifyContent: 'center' }}><ActivityIndicator /></View>;

    if (o.status === 'delivered') {
        return (
            <View style={{ flex: 1, backgroundColor: background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <Ionicons name="checkmark-circle" size={110} color={ok} />
                <Text style={{ color: ok, fontSize: 28, fontWeight: '900', marginTop: 8 }}>{T.delivered}</Text>
                {o.earnPaise > 0 ? <Text style={{ color: text, fontSize: 18, fontWeight: '800', marginTop: 8 }}>{T.deliveredEarned(rupee(o.earnPaise))}</Text> : null}
                <View style={{ alignSelf: 'stretch', marginTop: 36 }}><BigButton label={T.backHome} onPress={() => nav.goBack()} /></View>
            </View>
        );
    }
    if (finished) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Order #{orderNo}', { orderNo: o.orderNo })} />
                <View style={{ paddingTop: 16 }}>
                    <Banner tone="bad" icon="close-circle" text={T.cancelledTitle} />
                    <Text style={{ color: text, fontWeight: '700', fontSize: 16, marginHorizontal: 16 }}>{T.cancelledText}</Text>
                    <View style={{ margin: 16 }}><BigButton label={T.done} onPress={() => nav.goBack()} /></View>
                </View>
            </View>
        );
    }

    const ready = o.status === 'preparing' || o.status === 'ready';
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Order #{orderNo}', { orderNo: o.orderNo })} />
            <Steps labels={STEP_LABELS} step={step} />
            <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 200 }} keyboardShouldPersistTaps="handled" scrollEnabled={!mapTouch}>
                {offline ? <Banner tone="warn" icon="cloud-offline" text={T.offline} /> : null}
                {step > 0 ? (
                    <Banner
                        tone={cash ? 'warn' : 'ok'}
                        text={cash ? T.collectCash(rupeeAmount(o.payment.collectAmount)) : (o.payment.paidAtDoor ? T.paidAtDoor : T.paidOnline)}
                    />
                ) : null}

                {/* the time for this delivery, then the whole way from the shop to the customer as a picture. The journey itself runs in
                    Google Maps: tapping the map (or the button under it) opens it, and it opens by itself when he taps "collected". */}
                {!finished ? (
                    <View style={{ marginHorizontal: 16, marginBottom: 10 }}>
                        <TripClock onTheWay={step >= 1} allowedSec={d.plannedSec || plan?.allowedSec} due={due} eta={eta} style={{ marginBottom: 10 }} />
                        <RiderMap destination={spot} route={onTheWay && liveRoute ? liveRoute : plan} live={onTheWay} etaMin={etaMin} label={pinLabel} height={260} onGesture={setMapTouch}
                            startLabel={onTheWay ? tr('Your location') : shopName} endLabel={o.customer?.name || tr('Customer')} />
                        {/* always there from the moment he accepts: the journey in Google Maps, with its own turn-by-turn voice */}
                        <View style={{ marginTop: 10 }}>
                            <Button label={tr('Open in Google Maps')} icon="navigate" onPress={navigate} />
                        </View>
                        {onTheWay ? <LocationStatus style={{ marginTop: 10 }} /> : null}
                    </View>
                ) : null}

                {step === 0 ? (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 18 }}>{T.collectTitle}</Text>
                        <Text style={{ color: ready ? ok : muted, fontWeight: '800', fontSize: 14, marginTop: 4 }}>{ready ? T.shopReady : T.shopPreparing}</Text>
                        <View style={{ marginTop: 12 }}>
                            {(o.items || []).map((i, k) => (
                                <Text key={k} style={{ color: text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{i.quantity} × {i.name}</Text>
                            ))}
                        </View>
                        {o.note ? <Text style={{ color: muted, marginTop: 8, fontWeight: '600' }}>{tr('Note: {note}', { note: o.note })}</Text> : null}
                        {cash ? <View style={{ marginTop: 12 }}><Banner style={{ marginHorizontal: 0, marginBottom: 0 }} text={T.collectCash(rupeeAmount(o.payment.collectAmount))} /></View> : null}
                    </Card>
                ) : (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 18 }}>{o.customer?.name || tr('Customer')}</Text>
                        <Text style={{ color: text, fontSize: 16, fontWeight: '600', marginTop: 6, lineHeight: 23 }}>{addressLine(o.address)}</Text>
                        {o.note ? <Text style={{ color: muted, marginTop: 8, fontWeight: '600' }}>{tr('Note: {note}', { note: o.note })}</Text> : null}
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                            <View style={{ flex: 1 }}><Button label={T.problem} icon="warning" kind="ghost" onPress={() => setSheet('problem')} /></View>
                            {o.customer?.phone ? <View style={{ flex: 1 }}><Button label={T.call} icon="call" kind="ghost" onPress={callCustomer} /></View> : null}
                        </View>
                    </Card>
                )}

                {step === 2 ? (
                    <View style={{ marginHorizontal: 16 }}>
                        {cash && o.doorPay?.canStart ? <SmallLink label={T.customerPaysOnline} icon="qr-code" onPress={payByQr} /> : null}
                        {!d.pinRequired ? <SmallLink label={d.proof ? tr('Retake the photo') : T.addPhoto} icon="camera" onPress={addPhoto} /> : null}
                    </View>
                ) : null}

                <View style={{ marginHorizontal: 16, marginTop: 4 }}>
                    {step === 0 ? <SmallLink label={T.problem} icon="warning" danger onPress={() => setSheet('problem')} /> : null}
                    {step >= 1 ? <SmallLink label={tr('Cancel this order')} icon="close-circle" danger onPress={() => { setCancelReason(''); setCancelNote(''); setSheet('cancel'); }} /> : null}
                    <SmallLink label={T.sos} icon="alert-circle" danger onPress={() => setSosOpen(true)} />
                    {step === 0 ? <SmallLink label={T.cannotDo} onPress={giveBack} /> : null}
                </View>
            </ScrollView>

            {/* the one big button */}
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: background, borderTopWidth: 1, borderTopColor: border }}>
                {step === 0 ? (
                    <>
                        <BigButton label={T.collected} icon="bag-check" onPress={collect} busy={busy === 'collect'} disabled={!ready} />
                        {!ready ? <Text style={{ color: muted, textAlign: 'center', fontWeight: '700', marginTop: 8 }}>{T.waitForShop}</Text> : null}
                    </>
                ) : step === 1 ? (
                    <BigButton label={T.arrived} icon="location" onPress={arrived} busy={busy === 'arrived'} />
                ) : (
                    <BigButton
                        label={cash ? T.deliverCash(rupeeAmount(o.payment.collectAmount)) : T.deliver}
                        icon="checkmark-circle"
                        onPress={startDeliver}
                        busy={busy === 'deliver' || busy === 'photo'}
                    />
                )}
            </View>

            {/* the customer's PIN */}
            <Sheet visible={sheet === 'pin'} onClose={() => setSheet(null)} title={T.pinTitle}>
                <Text style={{ color: muted, fontWeight: '600', marginBottom: 12 }}>{T.pinHint}</Text>
                <TextInput
                    value={pin}
                    onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    autoFocus
                    maxLength={6}
                    placeholder="••••"
                    placeholderTextColor={muted}
                    style={{ borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 14, fontSize: 32, fontWeight: '900', letterSpacing: 10, textAlign: 'center', paddingVertical: 12 }}
                />
                <View style={{ marginTop: 14 }}>
                    <BigButton label={T.confirmDelivery} onPress={() => doDeliver(pin, false)} busy={busy === 'deliver'} disabled={pin.length < 4} />
                </View>
                {shopPhone ? <SmallLink label={T.callShop} icon="call" onPress={callShop} /> : null}
            </Sheet>

            {/* cancel the delivery he carries: a reason from the list (required), a note (optional) */}
            <Sheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} title={tr('Cancel this order')}>
                <Text style={{ color: muted, fontWeight: '600', marginBottom: 8 }}>{tr('Why are you cancelling? Choose one.')}</Text>
                {[
                    ['not_answering', tr('The customer is not answering')],
                    ['wrong_address', tr('I can not find the address')],
                    ['vehicle_problem', tr('My vehicle broke down')],
                    ['emergency', tr('I have an emergency or I am not well')],
                    ['order_damaged', tr('The order is spilled or damaged')],
                ].map(([key, label]) => (
                    <Pressable key={key} onPress={() => setCancelReason(key)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: border }, pressed && { backgroundColor: alpha(primary, 0.08) }]}>
                        <Ionicons name={cancelReason === key ? 'radio-button-on' : 'radio-button-off'} size={22} color={cancelReason === key ? error : muted} />
                        <Text style={{ color: text, fontSize: 16, fontWeight: '700', marginLeft: 12, flex: 1 }}>{label}</Text>
                    </Pressable>
                ))}
                <TextInput
                    value={cancelNote}
                    onChangeText={setCancelNote}
                    maxLength={120}
                    placeholder={tr('Add a note (optional)')}
                    placeholderTextColor={muted}
                    style={{ borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 14, fontSize: 15, paddingVertical: 10, paddingHorizontal: 14, marginTop: 14 }}
                />
                <View style={{ marginTop: 14 }}>
                    <BigButton label={tr('Cancel order')} icon="close-circle" kind="danger" onPress={doCancel} busy={busy === 'cancel'} disabled={!cancelReason} />
                </View>
            </Sheet>

            {/* a problem */}
            <Sheet visible={sheet === 'problem'} onClose={() => setSheet(null)} title={T.problemTitle}>
                <Text style={{ color: muted, fontWeight: '600', marginBottom: 8 }}>{T.problemHint}</Text>
                {T.reasons.map(([key, label]) => (
                    <Pressable key={key} onPress={() => sendProblem(key)} style={({ pressed }) => [{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: border }, pressed && { backgroundColor: alpha(primary, 0.08) }]}>
                        <Text style={{ color: text, fontSize: 16, fontWeight: '700' }}>{label}</Text>
                    </Pressable>
                ))}
                {shopPhone ? <View style={{ marginTop: 14 }}><BigButton label={T.callShop} icon="call" kind="outline" onPress={callShop} /></View> : null}
            </Sheet>

            <SosSheet visible={sosOpen} onClose={() => setSosOpen(false)} orderId={orderId} shopPhone={shopPhone} />

            {/* a Cash on delivery customer pays by QR at the door: the sheet asks until the money is in */}
            <PayQrSheet
                visible={!!qr}
                title={T.scanToPay}
                qr={qr}
                poll={async () => (await checkDoorPay(orderId)).paid}
                onPaid={refresh}
                onClose={() => setQr(null)}
            />
        </View>
    );
}
