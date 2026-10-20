// "Change pickup time": only LATER windows than the one he has are offered.
import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { Sheet, Button } from '../owners/ui';
import { PickupSlots, ease } from './cartParts';
import { showToast } from './shop';
import { errMsg } from './orders';
import { fetchPickupSlots, changePickupTime } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

export default function PickupTimeSheet({ visible, order, onClose, onDone }) {
    const { muted } = useBrand();
    const [res, setRes] = useState(null);
    const [picked, setPicked] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!visible) return undefined;
        let on = true;
        setPicked(null); setRes(null);
        fetchPickupSlots().then((r) => {
            if (!on) return;
            const after = new Date(order.scheduledFor).getTime();
            const slots = (r.slots || []).filter((x) => new Date(x.from).getTime() > after);
            setRes({ ...r, slots, message: slots.length ? null : (r.open === false ? r.message : tr('No later pickup time is available right now')) });
        }).catch(() => { if (on) setRes({ open: true, slots: [], message: tr('Could not load pickup times. Try again.') }); });
        return () => { on = false; };
    }, [visible, order?.scheduledFor]);

    const save = async () => {
        if (!picked || busy) return;
        setBusy(true);
        try {
            const o = await changePickupTime(order.id, picked);
            showToast(tr('Asked. The shop will reply soon.'));
            onDone(o); onClose();
        } catch (e) { showToast(errMsg(e)); } finally { setBusy(false); }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Change pickup time')}>
            <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{tr('You can ask for a later time only. It changes after the shop agrees.')}</Text>
            <PickupSlots res={res} picked={picked} onPick={(v) => { ease(); setPicked(v); }} />
            <Button label={tr('Ask for this time')} icon="checkmark" busy={busy} disabled={!picked} onPress={save} style={{ marginTop: 14 }} />
        </Sheet>
    );
}
