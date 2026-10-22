// A small popup for news: what a pickup customer said, a leave asked for or taken back, a review, a help call... for ANY alert whose Popup switch is on
// (Alerts screen). It shows the words of the notification and, for the owner, a way into the right page. The ones with their own popup (new orders, the
// kitchen's problems) are not shown here.
import React, { useEffect, useState } from 'react';
import { View, Text, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button } from './ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useAlertPrefs, alertOn } from '../../store/common/useAlertPrefs';
import { onNotification } from '../../api/common/socket';
import { ownerRoute } from '../../utils/owners/notificationRoute';
import { tr } from '../../i18n';

const OWN_POPUP = ['order_new', 'order_unaccepted_reminder', 'kitchen_problem'];

export default function OwnerInfoPopup({ navRef }) {
    const { surface, text, muted, primary } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const [queue, setQueue] = useState([]);
    const mine = ['admin', 'rider', 'kitchen', 'waiter'].includes(role);
    const on = mine && !(role === 'admin' && (customerView || access === 'blocked'));

    useEffect(() => {
        if (!on) { setQueue([]); return undefined; }
        return onNotification((n) => {
            const t = String(n?.type || '');
            if (!t || OWN_POPUP.includes(t)) return;
            const g = useAlertPrefs.getState().groups.find((x) => x.types.includes(t));
            if (!g || !g.can.p || !alertOn(t, 'p')) return;
            setQueue((q) => [...q, { key: String(n.id || n._id || Date.now() + Math.random()), title: n.title, body: n.body, type: t, data: n.data || {} }]);
        });
    }, [on]);

    const item = queue[0];
    if (!on || !item) return null;
    const next = () => setQueue((q) => q.slice(1));
    const to = role === 'admin' ? ownerRoute({ type: item.type, data: item.data }) : null;
    const open = () => { next(); if (to && navRef?.isReady?.()) navRef.navigate(to.name, to.params); };
    return (
        <Modal visible transparent animationType="fade" onRequestClose={next} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
                <View style={{ backgroundColor: surface, borderRadius: 24, padding: 20, borderColor: alpha(primary, 0.4), borderWidth: 1.5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: alpha(primary, 0.15), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                            <Ionicons name="notifications" size={22} color={primary} />
                        </View>
                        <Text style={{ color: text, fontSize: 18, fontWeight: '900', flex: 1 }}>{item.title}</Text>
                    </View>
                    <Text style={{ color: muted, fontSize: 15, marginTop: 12, lineHeight: 21 }}>{item.body}</Text>
                    {queue.length > 1 ? <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('{n} more', { n: queue.length - 1 })}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: 18 }}>
                        <Button label={tr('OK')} kind="ghost" onPress={next} style={{ flex: 1, marginRight: to ? 8 : 0 }} />
                        {to ? <Button label={tr('Open')} icon="open-outline" onPress={open} style={{ flex: 1 }} /> : null}
                    </View>
                </View>
            </View>
        </Modal>
    );
}
