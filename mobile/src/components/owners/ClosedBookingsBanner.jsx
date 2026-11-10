// A warning on the Reservations screen: reservations fall on a day or hour the shop is now closed (a holiday added later, a day off).
// One button cancels them all and sends every deposit back; the guests are told. Nothing shows when there are none.
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button } from './ui';
import { booking, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { ask } from '../common/dialog';
import { ease } from '../../utils/common/ease';
import { tr } from '../../i18n';

// asks, and when he agrees cancels them all (also used right after he saves hours or a closed day that hits reservations)
export async function offerCancelClosed(count) {
    if (!count) return false;
    const yes = await ask({
        title: tr('Reservations on a closed day'),
        message: count === 1
            ? tr('1 reservation falls on a day or time the shop is now closed. Cancel it and send the deposit back? The guest is told.')
            : tr('{n} reservations fall on days or times the shop is now closed. Cancel them all and send the deposits back? The guests are told.', { n: count }),
        confirmText: tr('Cancel and refund'), cancelText: tr('Keep them'), destructive: true, icon: 'calendar-outline',
    });
    if (!yes) { showToast(tr('Kept. You can cancel them any time from Reservations.')); return false; }
    try {
        const r = await booking.cancelClosed();
        showToast(tr('{n} reservations cancelled, deposits on their way back', { n: r.cancelled }));
        return true;
    } catch (e) { showToast(apiError(e)); return false; }
}

export default function ClosedBookingsBanner({ onDone }) {
    const { text, muted, error } = useBrand();
    const [n, setN] = useState(0);
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => { booking.closed().then((r) => { ease(); setN(r?.count || 0); }).catch(() => { }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    if (!n) return null;
    const go = async () => {
        setBusy(true);
        const done = await offerCancelClosed(n);
        setBusy(false);
        load();
        if (done && onDone) onDone();
    };
    return (
        <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: alpha(error, 0.4), backgroundColor: alpha(error, 0.08) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="warning" size={20} color={error} />
                <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 8 }}>{n === 1 ? tr('1 reservation falls on a closed day') : tr('{n} reservations fall on closed days', { n })}</Text>
            </View>
            <Text style={{ color: muted, fontSize: 12.5, marginTop: 4, marginBottom: 10 }}>{tr('The shop is closed then (a holiday or a day off). Cancel them and send the deposits back, or keep them if you will open.')}</Text>
            <Button label={tr('Cancel and refund')} kind="danger" icon="close-circle-outline" busy={busy} onPress={go} />
        </View>
    );
}
