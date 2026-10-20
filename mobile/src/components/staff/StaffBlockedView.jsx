// Shown instead of the staff app when the shop does not let this person in right now (switched off by the owner, the panel is off, not
// staff any more) or the phone is offline. Always a way out: Try again, or Log out.
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { Button } from '../owners/ui';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr } from '../../i18n';

export default function StaffBlockedView({ onRetry }) {
    const insets = useSafeAreaInsets();
    const { background, text, muted, warn, error } = useBrand();
    const state = useStaffStore((s) => s.state);
    const block = useStaffStore((s) => s.block);
    const offline = state === 'error';
    const c = offline ? muted : block?.code === 'paused' ? warn : error;
    const title = offline ? tr('No connection')
        : block?.code === 'paused' ? tr('Your account is switched off')
            : block?.code === 'panel_off' ? tr('This screen is switched off')
                : tr('This number is not shop staff');
    const hint = offline ? tr('Check your internet and try again.') : (block?.message || tr('Please ask the shop owner.'));
    return (
        <View style={{ flex: 1, backgroundColor: background, paddingTop: insets.top, paddingBottom: insets.bottom + 16, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: alpha(c, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={offline ? 'cloud-offline-outline' : 'lock-closed-outline'} size={38} color={c} />
            </View>
            <Text style={{ color: text, fontSize: 20, fontWeight: '900', marginTop: 18, textAlign: 'center' }}>{title}</Text>
            <Text style={{ color: muted, fontSize: 14.5, lineHeight: 21, marginTop: 8, textAlign: 'center', maxWidth: 320 }}>{hint}</Text>
            <View style={{ alignSelf: 'stretch', marginTop: 28 }}>
                <Button label={tr('Try again')} icon="refresh" onPress={onRetry} />
                <Button label={tr('Log out')} icon="log-out-outline" kind="ghost" style={{ marginTop: 10 }} onPress={() => { useStaffStore.getState().reset(); useAuthStore.getState().logout().catch(() => { }); }} />
            </View>
        </View>
    );
}
