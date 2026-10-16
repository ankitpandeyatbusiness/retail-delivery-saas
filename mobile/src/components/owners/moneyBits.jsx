// Money screens' shared pieces: the pay-by-UPI sheet (QR + "open UPI app" + waiting for the money), a small bar chart, a
// money row. Amounts here are PAISE unless a prop says otherwise.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useBrand, alpha } from '../common/kit';
import { Sheet, Button } from './ui';
import { rupees } from '../../utils/owners/riderRules';
import { clockTime } from '../../utils/owners/orderFlow';
import { shortDay } from '../../utils/owners/moneyRules';
import { showToast } from '../customers/shop';
import { LineShimmer } from './shimmer';

// qr: { amountPaise, upiString, imageUrl, expiresAt }.  poll(): resolves true once the money has arrived.
export function PayQrSheet({ visible, title, qr, poll, onPaid, onClose }) {
    const { muted, text, ok, border } = useBrand();
    const [paid, setPaid] = useState(false);
    const [checking, setChecking] = useState(false);
    const alive = useRef(false);

    useEffect(() => {
        if (!visible || !qr) return undefined;
        alive.current = true;
        setPaid(false);
        const tick = async () => {
            try {
                if (await poll()) {
                    if (!alive.current) return;
                    setPaid(true);
                    clearInterval(t);
                    setTimeout(() => { if (alive.current) { onPaid && onPaid(); onClose(); } }, 1600);
                }
            } catch (e) { /* try again on the next tick */ }
        };
        const t = setInterval(tick, 5000);
        return () => { alive.current = false; clearInterval(t); };
    }, [visible, qr]);   // eslint-disable-line react-hooks/exhaustive-deps

    const openUpi = () => {
        if (!qr?.upiString) return;
        Linking.openURL(qr.upiString).catch(() => showToast('No UPI app found on this phone. Scan the code with another phone.'));
    };
    const check = async () => {
        setChecking(true);
        try {
            if (await poll()) { setPaid(true); setTimeout(() => { onPaid && onPaid(); onClose(); }, 1200); }
            else showToast('Not received yet. It can take a minute.');
        } catch (e) { showToast('Could not check. Try again.'); } finally { setChecking(false); }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title={title || 'Pay by UPI'}>
            {qr ? (
                <View style={{ alignItems: 'center', paddingBottom: 8 }}>
                    <Text style={{ color: text, fontSize: 30, fontWeight: '900' }}>{rupees(qr.amountPaise)}</Text>
                    {paid ? (
                        <View style={{ alignItems: 'center', marginVertical: 30 }}>
                            <Text style={{ color: ok, fontSize: 56 }}>✓</Text>
                            <Text style={{ color: ok, fontWeight: '900', fontSize: 18 }}>Payment received</Text>
                        </View>
                    ) : (
                        <>
                            {qr.imageUrl ? (
                                <View style={{ marginVertical: 14, padding: 10, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: border }}>
                                    <Image source={{ uri: qr.imageUrl }} style={{ width: 220, height: 220 }} contentFit="contain" />
                                </View>
                            ) : <View style={{ height: 14 }} />}
                            {qr.expiresAt ? <Text style={{ color: muted, fontSize: 12, marginBottom: 12 }}>Valid until {clockTime(qr.expiresAt)}</Text> : null}
                            {qr.upiString ? <View style={{ alignSelf: 'stretch' }}><Button label="Pay with a UPI app" icon="phone-portrait" onPress={openUpi} /></View> : null}
                            <View style={{ alignSelf: 'stretch', marginTop: 10 }}><Button label="I have paid" kind="ghost" busy={checking} onPress={check} /></View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                                <LineShimmer width={28} height={10} />
                                <Text style={{ color: muted, marginLeft: 8, fontSize: 12 }}>Waiting for the payment. This page updates by itself.</Text>
                            </View>
                        </>
                    )}
                </View>
            ) : null}
        </Sheet>
    );
}

// bars for a series [{ label, value }]; the last bar is the strong one
export function Bars({ series, height = 70 }) {
    const { primary, muted } = useBrand();
    if (!series.length) return null;
    const max = Math.max(1, ...series.map((s) => s.value));
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height }}>
                {series.map((s, i) => (
                    <View key={s.label} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                        <View style={{ width: series.length > 20 ? '80%' : '60%', minHeight: 3, borderRadius: 3, height: `${Math.max(4, (s.value / max) * 100)}%`, backgroundColor: s.value <= 0 ? alpha(muted, 0.25) : i === series.length - 1 ? primary : alpha(primary, 0.5) }} />
                    </View>
                ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: muted, fontSize: 10 }}>{shortDay(series[0].label)}</Text>
                {series.length > 2 ? <Text style={{ color: muted, fontSize: 10 }}>{shortDay(series[series.length - 1].label)}</Text> : null}
            </View>
        </View>
    );
}

// a label on the left, an amount on the right, an optional note under the label
export function MoneyRow({ title, note, value, color, last }) {
    const { text, muted, border } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: border }}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                <Text style={{ color: text, fontWeight: '700' }} numberOfLines={2}>{title}</Text>
                {note ? <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{note}</Text> : null}
            </View>
            <Text style={{ color: color || text, fontWeight: '900' }}>{value}</Text>
        </View>
    );
}
