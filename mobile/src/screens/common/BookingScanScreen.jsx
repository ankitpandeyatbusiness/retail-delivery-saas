// The door scanner for booked tables, for the owner and for waiters. Scan a guest's QR (or type the 5 letter code),
// see who it is and which table, then "Mark arrived". A bad ticket says why: too early, wrong day, already used, cancelled.
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Button } from '../../components/owners/ui';
import { booking as ownerApi, apiError } from '../../api/owners/shopApi';
import { waiterScan, waiterArrive } from '../../api/staff/staffApi';
import { openPhoneSettings } from '../../utils/customers/whereAmI';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function BookingScanScreen() {
    const { who } = useRoute().params || {};
    const call = who === 'waiter' ? { scan: waiterScan, arrive: waiterArrive } : { scan: ownerApi.scan, arrive: ownerApi.arrive };
    const { background, text, muted, primary, ok, error, surface, border } = useBrand();
    const [perm, ask] = useCameraPermissions();
    const [res, setRes] = useState(null);       // what the server said about the last ticket
    const [token, setToken] = useState('');     // what was scanned or typed
    const [typed, setTyped] = useState('');
    const [typing, setTyping] = useState(false);
    const [busy, setBusy] = useState(false);
    const locked = useRef(false);

    const look = async (t) => {
        if (locked.current || !t) return;
        locked.current = true; setBusy(true); setToken(t);
        try { setRes(await call.scan(t)); } catch (e) { setRes({ state: 'error', message: apiError(e, 'Could not check this ticket. Try again.') }); } finally { setBusy(false); }
    };
    const again = () => { setRes(null); setToken(''); setTyped(''); locked.current = false; };
    const mark = async () => {
        setBusy(true);
        try { setRes(await call.arrive(token)); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    const b = res?.booking;
    const good = res && (res.state === 'ok' || res.state === 'arrived_now');
    const tone = good ? ok : res?.state === 'arrived' ? primary : error;
    const card = res ? (
        <View style={{ margin: 16, padding: 18, borderRadius: 20, backgroundColor: surface, borderWidth: 2, borderColor: tone }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name={good ? 'checkmark-circle' : res.state === 'arrived' ? 'information-circle' : 'close-circle'} size={34} color={tone} />
                <Text style={{ color: tone, fontWeight: '900', fontSize: 18, marginLeft: 10, flex: 1 }}>{res.state === 'arrived_now' ? tr('Marked as arrived') : tr(res.message)}</Text>
            </View>
            {b ? (
                <View style={{ marginTop: 14 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 30 }}>{b.table ? tr('Table {t}', { t: b.table }) : tr('No table')}</Text>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 17, marginTop: 4 }}>{b.name} · {tr('{n} guests', { n: b.party })}</Text>
                    <Text style={{ color: muted, marginTop: 2 }}>{b.date} · {b.time} · {tr('Code')} {b.code}</Text>
                    {res.state === 'arrived' && b.arrivedAt ? <Text style={{ color: muted, marginTop: 6 }}>{tr('Arrived at {t}', { t: new Date(b.arrivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</Text> : null}
                </View>
            ) : null}
            <View style={{ marginTop: 16 }}>
                {res.state === 'ok' ? <Button label={tr('Mark arrived')} icon="checkmark" busy={busy} onPress={mark} /> : null}
                <Button label={tr('Scan next guest')} icon="qr-code-outline" kind={res.state === 'ok' ? 'ghost' : 'primary'} onPress={again} style={{ marginTop: res.state === 'ok' ? 8 : 0 }} />
            </View>
        </View>
    ) : null;

    if (!perm) return <View style={{ flex: 1, backgroundColor: background }} />;

    if (res) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Scan booking')} />{card}</View>;

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: perm.granted && !typing ? '#000' : background }}>
            {perm.granted && !typing ? (
                <>
                    <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => look(data)} />
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}><PageHeader title={tr('Scan booking')} /></View>
                    <View style={{ position: 'absolute', left: 0, right: 0, top: '28%', alignItems: 'center' }} pointerEvents="none">
                        <View style={{ width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: '#fff' }} />
                        <Text style={{ color: '#fff', fontWeight: '800', marginTop: 16 }}>{tr("Point at the guest's booking QR")}</Text>
                    </View>
                    <View style={{ position: 'absolute', left: 16, right: 16, bottom: 28 }}>
                        <Button label={tr('Type the code instead')} icon="keypad-outline" kind="ghost" onPress={() => setTyping(true)} style={{ backgroundColor: '#fff' }} />
                    </View>
                </>
            ) : (
                <View style={{ flex: 1 }}>
                    <PageHeader title={tr('Scan booking')} />
                    <View style={{ padding: 20 }}>
                        {!perm.granted ? (
                            <View style={{ alignItems: 'center', marginBottom: 20 }}>
                                <Ionicons name="qr-code-outline" size={56} color={primary} />
                                <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 8 }}>{tr('Camera needed')}</Text>
                                <Text style={{ color: muted, textAlign: 'center', marginVertical: 6 }}>{tr("Allow the camera to scan the guest's QR, or type the code below.")}</Text>
                                <Button label={perm.canAskAgain ? tr('Allow camera') : tr('Open settings')} onPress={perm.canAskAgain ? ask : openPhoneSettings} />
                            </View>
                        ) : null}
                        <Text style={{ color: muted, fontWeight: '800', marginBottom: 6 }}>{tr('Booking code (5 letters)')}</Text>
                        <TextInput value={typed} onChangeText={(x) => setTyped(x.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5))} autoCapitalize="characters" autoCorrect={false} maxLength={5} placeholder="ABCDE"
                            placeholderTextColor={muted} style={{ borderWidth: 1, borderColor: border, borderRadius: 14, padding: 14, fontSize: 24, fontWeight: '900', letterSpacing: 6, color: text, textAlign: 'center', backgroundColor: surface }} />
                        <Button label={tr('Check code')} icon="search" busy={busy} disabled={typed.length !== 5} onPress={() => look(typed)} style={{ marginTop: 14 }} />
                        {perm.granted ? <Button label={tr('Use the camera')} icon="camera-outline" kind="ghost" onPress={() => setTyping(false)} style={{ marginTop: 8 }} /> : null}
                    </View>
                </View>
            )}
        </KeyboardAvoidingView>
    );
}
