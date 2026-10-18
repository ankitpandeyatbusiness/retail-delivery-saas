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
import { BigButton, SmallLink, Banner, Steps } from '../../components/riders/riderBits';
import { useRiderStore } from '../../store/riders/useRiderStore';
import {
    fetchRiderOrder, pickupOrder, markArrived, deliverOrder, reportProblem, releaseOrder, startDoorPay, checkDoorPay,
} from '../../api/riders/riderApi';
import { takeAndUploadProof } from '../../utils/riders/riderPhotos';
import { T, rupee, rupeeAmount, addressLine, errText } from '../../utils/riders/riderText';

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
    const { background, text, muted, surface, border, ok, primary } = useBrand();
    const [o, setO] = useState(null);
    const [gone, setGone] = useState(false);
    const [busy, setBusy] = useState('');
    const [sheet, setSheet] = useState(null);   // 'pin' | 'problem'
    const [pin, setPin] = useState('');
    const [qr, setQr] = useState(null);
    const shopPhone = useRiderStore((s) => s.me?.shopPhone);
    const alive = useRef(true);

    const refresh = useCallback(async () => {
        try {
            const r = await fetchRiderOrder(orderId);
            if (alive.current) setO(r);
        } catch (e) {
            if (e?.response?.status === 404 && alive.current) setGone(true);
        }
    }, [orderId]);
    useEffect(() => {
        alive.current = true;
        refresh();
        const id = setInterval(refresh, POLL_MS);
        return () => { alive.current = false; clearInterval(id); };
    }, [refresh]);

    const sync = (r) => { if (r?.id) setO(r); useRiderStore.getState().load(); };
    const run = async (key, fn) => {
        setBusy(key);
        try { return await fn(); } catch (e) { showToast(errText(e)); return null; } finally { setBusy(''); }
    };

    const d = o?.delivery || {};
    const finished = o && ['delivered', 'cancelled', 'undelivered'].includes(o.status);
    const step = d.status === 'accepted' ? 0 : d.arrivedAt ? 2 : 1;
    const cash = (o?.payment?.collectAmount || 0) > 0;
    const spot = o?.destination;

    /* ---------- actions ---------- */
    const collect = () => run('collect', async () => sync(await pickupOrder(orderId)));
    const arrived = () => run('arrived', async () => sync(await markArrived(orderId)));
    const navigate = () => {
        const q = spot ? `${spot.latitude},${spot.longitude}` : encodeURIComponent(addressLine(o?.address));
        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=two-wheeler`).catch(() => showToast('Could not open Maps'));
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
            if (pinValue != null) setPin('');
            themedAlert('Could not deliver', errText(e));
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
                <PageHeader title="Order" />
                <View style={{ padding: 24 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 16 }}>This order is not yours any more.</Text>
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
                <PageHeader title={`Order #${o.orderNo}`} />
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
            <PageHeader title={`Order #${o.orderNo}`} />
            <Steps labels={STEP_LABELS} step={step} />
            <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
                {step > 0 ? (
                    <Banner
                        tone={cash ? 'warn' : 'ok'}
                        text={cash ? T.collectCash(rupeeAmount(o.payment.collectAmount)) : (o.payment.paidAtDoor ? T.paidAtDoor : T.paidOnline)}
                    />
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
                        {o.note ? <Text style={{ color: muted, marginTop: 8, fontWeight: '600' }}>Note: {o.note}</Text> : null}
                        {cash ? <View style={{ marginTop: 12 }}><Banner style={{ marginHorizontal: 0, marginBottom: 0 }} text={T.collectCash(rupeeAmount(o.payment.collectAmount))} /></View> : null}
                    </Card>
                ) : (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 18 }}>{o.customer?.name || 'Customer'}</Text>
                        <Text style={{ color: text, fontSize: 16, fontWeight: '600', marginTop: 6, lineHeight: 23 }}>{addressLine(o.address)}</Text>
                        {o.note ? <Text style={{ color: muted, marginTop: 8, fontWeight: '600' }}>Note: {o.note}</Text> : null}
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                            <View style={{ flex: 1 }}><Button label={T.navigate} icon="navigate" onPress={navigate} /></View>
                            {o.customer?.phone ? <View style={{ flex: 1 }}><Button label={T.call} icon="call" kind="ghost" onPress={callCustomer} /></View> : null}
                        </View>
                    </Card>
                )}

                {step === 2 ? (
                    <View style={{ marginHorizontal: 16 }}>
                        {cash && o.doorPay?.canStart ? <SmallLink label={T.customerPaysOnline} icon="qr-code" onPress={payByQr} /> : null}
                        {!d.pinRequired ? <SmallLink label={d.proof ? 'Retake the photo' : T.addPhoto} icon="camera" onPress={addPhoto} /> : null}
                    </View>
                ) : null}

                <View style={{ marginHorizontal: 16, marginTop: 4 }}>
                    <SmallLink label={T.problem} icon="warning" danger onPress={() => setSheet('problem')} />
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
