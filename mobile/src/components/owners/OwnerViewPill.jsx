// While the owner is looking at the customer app, a small button stays on screen to go back to the owner panel.
import React from 'react';
import { Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { tr } from '../../i18n';

export default function OwnerViewPill({ onBack }) {
    const insets = useSafeAreaInsets();
    const { primary, onPrimary } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const customerView = useViewMode((s) => s.customerView);
    if (role !== 'admin' || !customerView) return null;
    return (
        <Pressable
            onPress={() => { if (onBack) onBack(); useViewMode.getState().setCustomerView(false); }}
            hitSlop={8}
            style={{
                position: 'absolute', right: 14, bottom: insets.bottom + 100, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 40, borderRadius: 20,
                backgroundColor: primary, elevation: 8, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
            }}
        >
            <Ionicons name="storefront" size={18} color={onPrimary} />
            <Text style={{ color: onPrimary, fontWeight: '900', marginLeft: 8, fontSize: 13 }}>{tr('Back to owner panel')}</Text>
        </Pressable>
    );
}
