// "Show QR to pay" for the balance of a bulk order (a pickup, at the counter): a QR made from the shop's own UPI ID for the exact balance. The customer scans it with
// any UPI app; the owner taps "UPI received" after he sees the success screen. The button that opens this is hidden for a shop with no UPI ID.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { useBrand } from '../common/kit';
import { Sheet, Button, money } from './ui';
import { LineShimmer } from './shimmer';
import { bulk as api, apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

export default function BulkPayQrSheet({ visible, bulkId, busy, onClose, onPaid }) {
    const { text, muted, error } = useBrand();
    const [state, setState] = useState('loading');   // loading | ok | none | error
    const [q, setQ] = useState(null);
    const [msg, setMsg] = useState('');
    useEffect(() => {
        if (!visible || !bulkId) return;
        setState('loading'); setQ(null);
        api.payQr(bulkId).then((r) => { setQ(r); setState(r.available ? 'ok' : 'none'); }).catch((e) => { setMsg(apiError(e)); setState('error'); });
    }, [visible, bulkId]);
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Pay by QR')}>
            {state === 'loading' ? <View style={{ alignItems: 'center', padding: 20 }}><LineShimmer width={220} height={220} /></View> : null}
            {state === 'ok' ? (
                <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: text, fontSize: 32, fontWeight: '900' }}>{money(q.payable)}</Text>
                    <Text style={{ color: muted, fontWeight: '700', marginBottom: 12 }}>{tr('Bulk order {c}: the balance', { c: q.code })}</Text>
                    <View style={{ padding: 10, borderRadius: 20, backgroundColor: '#FFFFFF' }}>
                        <Image source={{ uri: q.image }} style={{ width: 260, height: 260 }} contentFit="contain" />
                    </View>
                    <Text style={{ color: muted, textAlign: 'center', marginTop: 12 }}>{tr('Ask the customer to scan with any UPI app. The money goes to {id}.', { id: q.upiId })}</Text>
                    <View style={{ alignSelf: 'stretch', marginTop: 14 }}>
                        <Button label={tr('Paid? Mark UPI received')} icon="checkmark-done" busy={busy} onPress={onPaid} />
                    </View>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{tr('Only tap this after the customer shows the success screen.')}</Text>
                </View>
            ) : null}
            {state === 'none' ? (
                <View>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 16 }}>{tr('This shop has not added its UPI ID yet.')}</Text>
                    <View style={{ height: 12 }} />
                    <Button label={tr('OK')} onPress={onClose} />
                </View>
            ) : null}
            {state === 'error' ? (
                <View>
                    <Text style={{ color: error, fontWeight: '800' }}>{msg}</Text>
                    <View style={{ height: 12 }} />
                    <Button label={tr('Close')} kind="ghost" onPress={onClose} />
                </View>
            ) : null}
        </Sheet>
    );
}
