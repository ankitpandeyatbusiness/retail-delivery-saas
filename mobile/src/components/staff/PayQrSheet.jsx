// "Show QR to pay": a big QR for the exact bill. The guest scans it with any UPI app, the money goes to the shop, and the waiter taps UPI received.
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useBrand } from '../common/kit';
import { Sheet, Button, money } from '../owners/ui';
import { BigButton } from './staffBits';
import { fetchPayQr } from '../../api/staff/staffApi';
import { apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

export default function PayQrSheet({ visible, sessionId, busy, onClose, onPaid }) {
    const { text, muted, ok, error } = useBrand();
    const [state, setState] = useState('loading');   // loading | ok | none | error
    const [q, setQ] = useState(null);
    const [msg, setMsg] = useState('');
    useEffect(() => {
        if (!visible || !sessionId) return;
        setState('loading'); setQ(null);
        fetchPayQr(sessionId)
            .then((r) => { setQ(r); setState(r.available ? 'ok' : 'none'); })
            .catch((e) => { setMsg(apiError(e)); setState('error'); });
    }, [visible, sessionId]);
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Pay by QR')}>
            {state === 'loading' ? <View style={{ padding: 40 }}><ActivityIndicator /></View> : null}
            {state === 'ok' ? (
                <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: text, fontSize: 32, fontWeight: '900' }}>{money(q.payable)}</Text>
                    <Text style={{ color: muted, fontWeight: '700', marginBottom: 12 }}>{tr('Table {n}', { n: q.table })}</Text>
                    <View style={{ padding: 10, borderRadius: 20, backgroundColor: '#FFFFFF' }}>
                        <Image source={{ uri: q.image }} style={{ width: 260, height: 260 }} contentFit="contain" />
                    </View>
                    <Text style={{ color: muted, textAlign: 'center', marginTop: 12 }}>{tr('Ask the guest to scan with any UPI app. The money goes to {id}.', { id: q.upiId })}</Text>
                    <View style={{ alignSelf: 'stretch', marginTop: 14 }}>
                        <BigButton label={tr('Paid? Mark UPI received')} icon="checkmark-done" bg={ok} ink="#FFFFFF" busy={busy} onPress={onPaid} />
                    </View>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 8, textAlign: 'center' }}>{tr('Only tap this after the guest shows the success screen.')}</Text>
                </View>
            ) : null}
            {state === 'none' ? (
                <View>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 16 }}>{tr('This shop has not added its UPI ID yet.')}</Text>
                    <Text style={{ color: muted, marginTop: 6, marginBottom: 14 }}>{tr('Ask the owner to add it in Shop > Dine in > Shop UPI ID. Until then, take cash or UPI by hand.')}</Text>
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
