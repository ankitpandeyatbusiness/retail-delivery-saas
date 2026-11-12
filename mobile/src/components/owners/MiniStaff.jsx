// A round letter and a duty pill for a cook or waiter, for the cards on a computer (kept apart from the Staff pages so they do not import each other).
import React from 'react';
import { View, Text } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Pill } from './ui';
import { tr } from '../../i18n';

export function MiniAvatar({ p, size = 62 }) {
    const { primary } = useBrand();
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: primary, fontWeight: '900', fontSize: size * 0.42 }}>{(p.name || p.phone || '?').charAt(0).toUpperCase()}</Text>
        </View>
    );
}

export function MiniDuty({ p }) {
    const { ok, warn, muted } = useBrand();
    if (!p.isActive) return <Pill label={tr('Switched off')} color={muted} />;
    if (p.duty === 'on') return <Pill label={tr('On duty')} color={ok} icon="radio-button-on" />;
    return <Pill label={tr(p.duty === 'holiday' ? 'Day off' : p.duty === 'outside' ? 'Outside hours' : p.duty === 'shop_closed' ? 'Shop closed' : 'Off duty')} color={warn} icon="moon-outline" />;
}
