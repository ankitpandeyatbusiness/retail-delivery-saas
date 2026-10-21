// Shop > App lock: ask for a PIN, fingerprint or face when the app opens.
import React from 'react';
import { View } from 'react-native';
import { useBrand } from '../../components/common/kit';
import { PageHeader } from '../../components/owners/ui';
import { AppLockSettings } from '../../lock/LockUI';
import { tr } from '../../i18n';

export default function OwnerAppLockScreen() {
    const { background } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('App lock')} />
            <AppLockSettings />
        </View>
    );
}
