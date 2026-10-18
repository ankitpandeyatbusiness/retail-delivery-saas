// "Keep the app working": the three phone settings that stop a phone from killing the app while a rider is on duty.
// Shown once, the first time he starts duty, and any time from Profile.
import React from 'react';
import { Text, View, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Sheet } from '../owners/ui';
import { BigButton } from './riderBits';
import { T } from '../../utils/riders/riderText';

const ICON = { location: 'location', battery: 'battery-charging', recent: 'phone-portrait' };

export default function KeepRunningSheet({ visible, onClose }) {
    const { text, muted, primary } = useBrand();
    return (
        <Sheet visible={visible} onClose={onClose} title={T.keepRunning}>
            <Text style={{ color: muted, fontWeight: '700', marginBottom: 12 }}>{T.keepRunningTitle}</Text>
            {T.keepSteps.map(([key, title, body], i) => (
                <View key={key} style={{ flexDirection: 'row', marginBottom: 14 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                        <Ionicons name={ICON[key]} size={20} color={primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{i + 1}. {title}</Text>
                        <Text style={{ color: muted, fontWeight: '600', marginTop: 2, lineHeight: 20 }}>{body}</Text>
                    </View>
                </View>
            ))}
            <BigButton label={T.openSettings} icon="settings" onPress={() => Linking.openSettings().catch(() => { })} />
            <View style={{ marginTop: 10 }}><BigButton label={T.gotIt} kind="outline" onPress={onClose} /></View>
        </Sheet>
    );
}
