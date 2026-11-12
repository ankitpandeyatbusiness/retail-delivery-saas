// Shop > App lock: ask for a PIN, fingerprint or face when the app opens.
import React from 'react';
import { View, Platform } from 'react-native';
import AppOnlyNotice from '../../components/common/AppOnlyNotice';
import { useBrand } from '../../components/common/kit';
import { PageHeader } from '../../components/owners/ui';
import { AppLockSettings } from '../../lock/LockUI';
import { tr } from '../../i18n';

export default function OwnerAppLockScreen() {
    const { background } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('App lock')} />
            {Platform.OS === 'web' ? <AppOnlyNotice title={tr('App lock is only available in the app')} text={tr('The PIN, fingerprint or face lock protects the app on your phone. Open the shop app to set it up.')} /> : <AppLockSettings />}
        </View>
    );
}
