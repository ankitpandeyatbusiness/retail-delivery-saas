// A cancelled order: a popup the cook or the waiter has to tap away, so a dish is never made or carried for an order that is gone.
import React from 'react';
import { View, Text, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { BigButton } from './staffBits';
import { useStaffAlertStore } from '../../store/staff/useStaffAlertStore';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { tr } from '../../i18n';

export default function StaffAlertPopup() {
    const { surface, border, text, muted, error, primary, onPrimary } = useBrand();
    const items = useStaffAlertStore((s) => s.items);
    const role = useStaffStore((s) => s.me?.role);
    const a = items[0];
    if (!a) return null;
    const cook = role === 'kitchen';
    return (
        <Modal visible transparent animationType="fade" onRequestClose={() => useStaffAlertStore.getState().dismiss(a.id)} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <View style={{ width: '100%', maxWidth: 420, backgroundColor: surface, borderColor: alpha(error, 0.5), borderWidth: 1.5, borderRadius: 24, padding: 22, alignItems: 'center' }}>
                    <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: alpha(error, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="close-circle" size={42} color={error} />
                    </View>
                    <Text style={{ color: text, fontSize: 24, fontWeight: '900', marginTop: 14, textAlign: 'center' }}>{tr('Order #{n} cancelled', { n: a.orderNo })}</Text>
                    {a.table ? <Text style={{ color: muted, fontWeight: '700', marginTop: 4 }}>{tr('Table {n}', { n: a.table })}</Text> : null}
                    <Text style={{ color: text, fontSize: 17, fontWeight: '700', marginTop: 10, textAlign: 'center' }}>{cook ? tr('Stop making it.') : tr('Do not serve it.')}</Text>
                    {items.length > 1 ? <Text style={{ color: muted, marginTop: 8, fontSize: 12.5 }}>{tr('{n} more', { n: items.length - 1 })}</Text> : null}
                    <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
                        <BigButton label={tr('OK')} icon="checkmark" bg={primary} ink={onPrimary} onPress={() => useStaffAlertStore.getState().dismiss(a.id)} />
                    </View>
                </View>
            </View>
        </Modal>
    );
}
