// The help button, as a sheet: one clear button to tell the shop, then what to do next (call the shop, or 112).
import React, { useEffect, useState } from 'react';
import { Text, Linking, View } from 'react-native';
import { useBrand } from '../common/kit';
import { Sheet } from '../owners/ui';
import { showToast } from '../customers/shop';
import { BigButton } from './riderBits';
import { sendSos } from '../../api/riders/riderApi';
import { T, errText } from '../../utils/riders/riderText';

export default function SosSheet({ visible, onClose, orderId, shopPhone }) {
    const { text, muted, ok } = useBrand();
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(null);   // { shopPhone } once the shop was told
    useEffect(() => { if (visible) { setSent(null); setBusy(false); } }, [visible]);

    const send = async () => {
        setBusy(true);
        try { const r = await sendSos(orderId); setSent({ shopPhone: r.shopPhone || shopPhone }); }
        catch (e) { showToast(errText(e)); }
        setBusy(false);
    };
    const call = (n) => Linking.openURL(`tel:${n}`).catch(() => { });
    const phone = sent?.shopPhone || shopPhone;
    return (
        <Sheet visible={visible} onClose={onClose} title={T.sosTitle}>
            {!sent ? (
                <>
                    <Text style={{ color: muted, fontWeight: '600', marginBottom: 14, lineHeight: 21 }}>{T.sosText}</Text>
                    <BigButton label={T.sosSend} icon="alert-circle" kind="danger" onPress={send} busy={busy} />
                </>
            ) : (
                <>
                    <Text style={{ color: ok, fontWeight: '900', fontSize: 18, marginBottom: 6 }}>{T.sosSent}</Text>
                    <Text style={{ color: text, fontWeight: '700', marginBottom: 14 }}>{T.sosEmergency}</Text>
                    <BigButton label={T.call112} icon="call" kind="danger" onPress={() => call('112')} />
                    {phone ? <View style={{ marginTop: 10 }}><BigButton label={T.callShop} icon="call" kind="outline" onPress={() => call(phone)} /></View> : null}
                </>
            )}
        </Sheet>
    );
}
