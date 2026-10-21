// More > App lock: ask for a PIN, fingerprint or face when the panel opens. Required for the supreme admin.
import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { Screen } from '../../components/layout';
import { AppLockSettings } from '../../lock/LockUI';

export default function AppLockScreen() {
    const t = useTheme();
    return (
        <Screen title="App lock" subtitle="Keep this panel private" scroll={false}>
            <View style={{ flex: 1, backgroundColor: t.bg }}><AppLockSettings /></View>
        </Screen>
    );
}
