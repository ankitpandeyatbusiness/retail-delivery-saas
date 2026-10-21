// What the owner can do about a problem the cook reported: tell the customer (a polite note), cancel (the money goes back by itself when it was
// paid online), or leave it. The words sent to the customer are written by the server, politely, and shown here before they go.
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useBrand } from '../common/kit';
import { Button } from './ui';
import { resolveKitchenProblem, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { themedAlert } from '../common/dialog';
import { tr } from '../../i18n';

export const problemWords = (p) => (p?.kind === 'out_of_stock' ? tr('a dish is finished') : p?.kind === 'cannot_make' ? tr('it cannot be made') : (p?.note || tr('there is a problem')));

export default function KitchenProblemActions({ order, onDone, onLater }) {
    const { muted } = useBrand();
    const [busy, setBusy] = useState('');
    const paid = !!order.payment?.method && order.payment.method !== 'cod' && order.payment.status === 'paid';
    const can = ['accepted', 'preparing', 'ready'].includes(order.status);
    const go = async (action) => {
        setBusy(action);
        try {
            await resolveKitchenProblem(order.id || order._id, action);
            showToast(action === 'tell' ? tr('The customer was told') : action === 'cancel' ? tr(paid ? 'Cancelled. The refund is on its way.' : 'Order cancelled') : tr('Done'));
            onDone?.(action);
        } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const confirmCancel = () => themedAlert(tr('Cancel this order?'), paid ? tr('The customer is told sorry, and the full payment is refunded.') : tr('The customer is told sorry.'), [
        { text: tr('Keep it'), style: 'cancel' },
        { text: paid ? tr('Cancel and refund') : tr('Cancel order'), style: 'destructive', onPress: () => go('cancel') },
    ], { icon: 'close-circle-outline' });
    return (
        <View>
            <Button label={tr('Tell the customer')} icon="chatbubble-ellipses-outline" busy={busy === 'tell'} disabled={!!busy} onPress={() => go('tell')} />
            <Text style={{ color: muted, fontSize: 12, margin: 6, marginBottom: 10 }}>{tr('Sends a polite note: sorry, it may take longer.')}</Text>
            {can ? <Button label={paid ? tr('Cancel and refund') : tr('Cancel order')} icon="close-circle-outline" kind="ghost" busy={busy === 'cancel'} disabled={!!busy} onPress={confirmCancel} style={{ marginBottom: 8 }} /> : null}
            <Button label={onLater ? tr('Later') : tr('I will handle it')} kind="ghost" disabled={!!busy} onPress={() => (onLater ? onLater() : go('dismiss'))} />
        </View>
    );
}
