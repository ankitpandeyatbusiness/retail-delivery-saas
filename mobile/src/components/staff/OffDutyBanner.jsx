// "You are off duty": shown on the kitchen and waiter screens when the person is not on duty, so a silent phone is never a mystery.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { saveDuty } from '../../api/staff/staffApi';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const WORDS = { off: 'You are off duty. No alerts.', outside: 'Outside your hours. No alerts.', holiday: 'Day off today. No alerts.', shop_closed: 'The shop is closed. No alerts until it opens.' };

export default function OffDutyBanner() {
    const { text, primary, warn } = useBrand();
    const status = useStaffStore((s) => s.me?.dutyStatus);
    const onDuty = useStaffStore((s) => s.me?.onDuty);
    const winding = useStaffStore((s) => s.me?.winding);
    if (winding && onDuty !== false) {
        return (
            <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: alpha(primary, 0.12), flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="time-outline" size={18} color={primary} style={{ marginRight: 8 }} />
                <Text style={{ color: text, fontWeight: '700', flex: 1, fontSize: 13 }}>{tr('The shop is closed to new orders. Finish the orders in hand.')}</Text>
            </View>
        );
    }
    if (onDuty !== false || !WORDS[status]) return null;
    const goLive = async () => {
        try { const r = await saveDuty({ online: true }); useStaffStore.getState().patchMe({ onDuty: r.onDuty, dutyStatus: r.status }); showToast(tr('You are live')); } catch (e) { showToast(tr('Could not change. Try again.')); }
    };
    return (
        <View style={{ marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: alpha(warn, 0.16), flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="moon-outline" size={18} color={warn} style={{ marginRight: 8 }} />
            <Text style={{ color: text, fontWeight: '700', flex: 1, fontSize: 13 }}>{tr(WORDS[status])}</Text>
            {status === 'off' ? <Pressable onPress={goLive} hitSlop={8}><Text style={{ color: primary, fontWeight: '900' }}>{tr('Go live')}</Text></Pressable> : null}
        </View>
    );
}
