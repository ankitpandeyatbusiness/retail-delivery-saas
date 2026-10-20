// Small pieces the kitchen and waiter screens share: the page header, the job badge and the loading skeleton.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
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

// one slow clock for every card on a screen (a timer per card would be a lot of timers)
let tick = 0;
const subs = new Set();
let timer = null;
export function useMinuteClock() {
    const [, set] = useState(tick);
    useEffect(() => {
        subs.add(set);
        if (!timer) timer = setInterval(() => { tick += 1; subs.forEach((f) => f(tick)); }, 20000);
        return () => { subs.delete(set); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
    }, []);
}

export const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const minsSince = (d) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
export const minWord = (m) => (m < 1 ? tr('just now') : tr('{n} min', { n: m }));

// a big button a cook or waiter can hit with a wet thumb: full width, tall, clear colours in both looks
export function BigButton({ label, icon, bg, ink, busy, disabled, onPress }) {
    return (
        <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button" style={({ pressed }) => ({ minHeight: 56, borderRadius: 16, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : busy ? 0.6 : pressed ? 0.8 : 1 })}>
            {busy ? <ActivityIndicator color={ink} /> : (
                <>
                    <Ionicons name={icon} size={22} color={ink} style={{ marginRight: 8 }} />
                    <Text style={{ color: ink, fontWeight: '900', fontSize: 17 }}>{label}</Text>
                </>
            )}
        </Pressable>
    );
}

// the two-way switch at the top of the kitchen and waiter lists. tabs: [[id, label, count, hot]]
export function Segment({ value, onChange, tabs }) {
    const { primary, onPrimary, surface, border, muted, error } = useBrand();
    return (
        <View style={{ flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 3, borderRadius: 14, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
            {tabs.map(([id, label, n, hot]) => {
                const on = id === value;
                const dot = hot ? error : primary;
                return (
                    <Pressable key={id} onPress={() => onChange(id)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', backgroundColor: on ? primary : 'transparent' }}>
                        <Text style={{ color: on ? onPrimary : muted, fontWeight: '900', fontSize: 14 }}>{label}</Text>
                        {n > 0 ? (
                            <View style={{ marginLeft: 6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.22) : alpha(dot, 0.18) }}>
                                <Text style={{ color: on ? onPrimary : dot, fontWeight: '900', fontSize: 12 }}>{n}</Text>
                            </View>
                        ) : null}
                    </Pressable>
                );
            })}
        </View>
    );
}
