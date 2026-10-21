// A small popup for news the owner only has to see: what a pickup customer said ("on my way", "I am here", "late", "more time"...).
// It shows the words the server wrote (who, what, the dishes) and a way into the order. Switched by the Alerts screen (group "Pickup customers", Popup).
import React, { useEffect, useState } from 'react';
import { View, Text, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button } from './ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { alertOn } from '../../store/common/useAlertPrefs';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';

const TYPES = ['pickup_intent'];

export default function OwnerInfoPopup({ navRef }) {
    const { surface, text, muted, primary } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    const access = useOwnerStore((s) => s.access);
    const [queue, setQueue] = useState([]);
    const on = role === 'admin' && !customerView && access !== 'blocked';

    useEffect(() => {
        if (!on) { setQueue([]); return undefined; }
        return onNotification((n) => {
            if (!n || !TYPES.includes(n.type) || !alertOn(n.type, 'p')) return;
            setQueue((q) => [...q, { key: String(n.id || n._id || Date.now() + Math.random()), title: n.title, body: n.body, orderId: n.data?.orderId }]);
        });
    }, [on]);

    const item = queue[0];
    if (!on || !item) return null;
    const next = () => setQueue((q) => q.slice(1));
    const open = () => { next(); if (item.orderId && navRef?.isReady?.()) navRef.navigate('OwnerOrder', { id: String(item.orderId) }); };
    return (
        <Modal visible transparent animationType="fade" onRequestClose={next} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
                <View style={{ backgroundColor: surface, borderRadius: 24, padding: 20, borderColor: alpha(primary, 0.4), borderWidth: 1.5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: alpha(primary, 0.15), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                            <Ionicons name="walk" size={24} color={primary} />
                        </View>
                        <Text style={{ color: text, fontSize: 18, fontWeight: '900', flex: 1 }}>{item.title}</Text>
                    </View>
                    <Text style={{ color: muted, fontSize: 15, marginTop: 12, lineHeight: 21 }}>{item.body}</Text>
                    {queue.length > 1 ? <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('{n} more', { n: queue.length - 1 })}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: 18 }}>
                        <Button label={tr('OK')} kind="ghost" onPress={next} style={{ flex: 1, marginRight: 8 }} />
                        {item.orderId ? <Button label={tr('Open order')} icon="open-outline" onPress={open} style={{ flex: 1 }} /> : null}
                    </View>
                </View>
            </View>
        </Modal>
    );
}
