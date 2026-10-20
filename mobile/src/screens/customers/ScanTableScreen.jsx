// Scan the QR sticker on the table: the camera reads it, the shop checks it, and he is seated at that table.
import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Button } from '../../components/owners/ui';
import { applyTableLink } from '../../utils/customers/tableLink';
import { openPhoneSettings } from '../../utils/customers/whereAmI';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function ScanTableScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [perm, ask] = useCameraPermissions();
    const [busy, setBusy] = useState(false);
    const done = useRef(false);

    const onScan = async ({ data }) => {
        if (done.current || busy) return;
        done.current = true; setBusy(true);
        const r = await applyTableLink(data);
        if (r.ok) { showToast(tr('You are at table {n}', { n: r.table })); nav.goBack(); return; }
        showToast(tr(r.message));
        setTimeout(() => { done.current = false; setBusy(false); }, 1800);   // try another code
    };

    if (!perm) return <View style={{ flex: 1, backgroundColor: background }} />;
    if (!perm.granted) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Scan table QR')} />
                <View style={{ padding: 28, alignItems: 'center' }}>
                    <Ionicons name="qr-code-outline" size={64} color={primary} />
                    <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 12 }}>{tr('Camera needed')}</Text>
                    <Text style={{ color: muted, textAlign: 'center', marginTop: 6, marginBottom: 18 }}>{tr('Allow the camera to scan the QR on your table.')}</Text>
                    <Button label={perm.canAskAgain ? tr('Allow camera') : tr('Open settings')} onPress={perm.canAskAgain ? ask : openPhoneSettings} />
                </View>
            </View>
        );
    }
    return (
        <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}><PageHeader title={tr('Scan table QR')} /></View>
            <View style={{ position: 'absolute', left: 0, right: 0, top: '32%', alignItems: 'center' }} pointerEvents="none">
                <View style={{ width: 230, height: 230, borderRadius: 24, borderWidth: 3, borderColor: '#fff' }} />
                <Text style={{ color: '#fff', fontWeight: '800', marginTop: 16 }}>{tr('Point at the QR on your table')}</Text>
            </View>
        </View>
    );
}
