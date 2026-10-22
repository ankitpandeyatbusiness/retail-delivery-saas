// "Kitchen: order #1042, a dish is finished": slides over whatever the owner is doing, with the answers (tell the customer, cancel and refund).
// Nothing is decided for him. "Later" keeps it blinking on the Home card and shows it again on the order page.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import KitchenProblemActions, { problemWords } from './KitchenProblemActions';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onNotification, onOrderUpdate } from '../../api/common/socket';
import { fetchOrder } from '../../api/owners/shopApi';
import { alertOn } from '../../store/common/useAlertPrefs';
import { tr } from '../../i18n';
import { turnOffSlider } from '../common/AlertSliderHost';

export default function KitchenProblemPopup() {
    const { surface, text, muted, warn } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const [queue, setQueue] = useState([]);
    const seen = useRef(new Set());
    const on = role === 'admin' && !customerView && access !== 'blocked';

    useEffect(() => {
        if (!on) { setQueue([]); return undefined; }
        const offN = onNotification((n) => {
            const id = n?.type === 'kitchen_problem' ? String(n?.data?.orderId || '') : '';
            if (!id || seen.current.has(id) || !alertOn('kitchen_problem', 'p')) return;
            seen.current.add(id);
            fetchOrder(id).then((o) => { if (o?.kitchen?.problem?.at && !o.kitchen.problem.handledAt) setQueue((q) => (q.some((x) => String(x.id) === id) ? q : [...q, o])); }).catch(() => { });
        });
        // answered on another phone, or the order ended: nothing left to decide
        const offU = onOrderUpdate((p) => {
            if (p?.kind === 'kitchen_problem_done' || ['cancelled', 'delivered', 'undelivered'].includes(p?.status)) setQueue((q) => q.filter((o) => String(o.id) !== String(p.orderId)));
        });
        return () => { offN(); offU(); };
    }, [on]);

    const o = queue[0];
    if (!on || !o) return null;
    const p = o.kitchen.problem;
    const next = () => setQueue((q) => q.slice(1));
    return (
        <Modal visible transparent animationType="fade" onRequestClose={next} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                <View style={{ backgroundColor: surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 28, borderColor: alpha(warn, 0.5), borderWidth: 1.5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: alpha(warn, 0.16), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                            <Ionicons name="restaurant" size={24} color={warn} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontSize: 19, fontWeight: '900' }}>{tr('Kitchen: order #{n}', { n: o.orderNo })}</Text>
                            <Text style={{ color: muted, fontWeight: '600', marginTop: 1 }}>{p.byName ? p.byName + ' · ' : ''}{tr(o.orderType === 'dine_in' ? 'Dine in' : o.orderType === 'pickup' ? 'Pickup' : 'Delivery')}</Text>
                        </View>
                    </View>
                    <Text style={{ color: text, fontSize: 17, fontWeight: '800', marginVertical: 14 }}>{p.dish ? p.dish + ': ' : ''}{problemWords(p)}</Text>
                    {p.kind === 'out_of_stock' ? <Text style={{ color: muted, fontSize: 12.5, marginTop: -8, marginBottom: 12 }}>{tr('The dish is switched off, so no one else can order it.')}</Text> : null}
                    <KitchenProblemActions order={o} onDone={next} onLater={next} />
                    <Pressable onPress={() => { next(); turnOffSlider('kitchen_problem'); }} hitSlop={8} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', marginTop: 14 }} accessibilityRole="button">
                        <Ionicons name="notifications-off-outline" size={15} color={muted} />
                        <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginLeft: 6 }}>{tr('Turn off this slider')}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}
