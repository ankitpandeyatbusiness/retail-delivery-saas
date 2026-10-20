// Small pieces the kitchen and waiter screens share: the page header, the job badge and the loading skeleton.
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { Skel } from '../common/motion';
import { tr } from '../../i18n';

export const JOBS = {
    kitchen: { label: 'Kitchen', icon: 'flame' },
    waiter: { label: 'Waiter', icon: 'restaurant' },
};

export function JobBadge({ role }) {
    const { primary } = useBrand();
    const j = JOBS[role] || JOBS.kitchen;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: alpha(primary, 0.14) }}>
            <Ionicons name={j.icon} size={12} color={primary} style={{ marginRight: 4 }} />
            <Text style={{ color: primary, fontSize: 12, fontWeight: '800' }}>{tr(j.label)}</Text>
        </View>
    );
}

export function StaffHeader({ title, subtitle, right }) {
    const insets = useSafeAreaInsets();
    const { text, muted, background } = useBrand();
    return (
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: background, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: text, fontSize: 22, fontWeight: '900' }} numberOfLines={1}>{title}</Text>
                {subtitle ? <Text style={{ color: muted, fontSize: 13, fontWeight: '600', marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
            </View>
            {right}
        </View>
    );
}

export function StaffSkeleton() {
    const insets = useSafeAreaInsets();
    const { background } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background, paddingTop: insets.top + 16, paddingHorizontal: 16 }}>
            <Skel width={160} height={24} radius={8} />
            <Skel width={110} height={14} radius={7} style={{ marginTop: 8 }} />
            <Skel height={120} radius={18} style={{ marginTop: 24 }} />
            <Skel height={80} radius={18} style={{ marginTop: 14 }} />
        </View>
    );
}
