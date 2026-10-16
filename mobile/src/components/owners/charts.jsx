// Charts for the progress report. Tap a bar to read its number. All draw with plain views, so they are light.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { money } from './ui';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function pointLabel(key, kind) {
    if (kind === 'month') return MONTHS[Number(String(key).slice(5, 7)) - 1] || key;
    const [, m, d] = String(key).split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1] || ''}`;
}

// points: [{ key, orders, revenue }], kind: day | week | month
export function SalesChart({ points, kind, height = 110 }) {
    const { primary, muted, text } = useBrand();
    const [pick, setPick] = useState(null);
    useEffect(() => { setPick(null); }, [points]);
    if (!points?.length) return null;
    const max = Math.max(1, ...points.map((p) => p.revenue));
    const shown = pick !== null ? points[pick] : null;
    const total = points.reduce((a, p) => a + p.revenue, 0);
    return (
        <View>
            <View style={{ minHeight: 34, justifyContent: 'center' }}>
                {shown ? (
                    <Text style={{ color: text, fontWeight: '900' }}>
                        {kind === 'week' ? 'Week of ' : ''}{pointLabel(shown.key, kind)}: {money(shown.revenue)} <Text style={{ color: muted, fontWeight: '700' }}>from {shown.orders} {shown.orders === 1 ? 'order' : 'orders'}</Text>
                    </Text>
                ) : <Text style={{ color: muted }}>Tap a bar to see its number. {total > 0 ? '' : 'No sales yet in this time.'}</Text>}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height }}>
                {points.map((p, i) => {
                    const on = pick === i;
                    return (
                        <Pressable key={p.key} onPress={() => setPick(on ? null : i)} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
                            <View style={{ width: points.length > 40 ? '70%' : '62%', minHeight: 3, height: `${Math.max(3, (p.revenue / max) * 100)}%`, borderRadius: 4, backgroundColor: p.revenue <= 0 ? alpha(muted, 0.25) : on ? primary : alpha(primary, 0.55) }} />
                        </Pressable>
                    );
                })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
                <Text style={{ color: muted, fontSize: 10 }}>{pointLabel(points[0].key, kind)}</Text>
                {points.length > 2 ? <Text style={{ color: muted, fontSize: 10 }}>{pointLabel(points[Math.floor(points.length / 2)].key, kind)}</Text> : null}
                <Text style={{ color: muted, fontSize: 10 }}>{pointLabel(points[points.length - 1].key, kind)}</Text>
            </View>
        </View>
    );
}

// the 24 hours of the day: when orders arrive (the strongest hour is solid)
export function HourStrip({ byHour, peak }) {
    const { primary, muted } = useBrand();
    const max = Math.max(1, ...byHour);
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 54 }}>
                {byHour.map((n, h) => (
                    <View key={h} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <View style={{ width: '66%', minHeight: 2, height: `${Math.max(3, (n / max) * 100)}%`, borderRadius: 2, backgroundColor: n <= 0 ? alpha(muted, 0.2) : h === peak ? primary : alpha(primary, 0.45) }} />
                    </View>
                ))}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                {['12 AM', '6 AM', '12 PM', '6 PM', '11 PM'].map((l) => <Text key={l} style={{ color: muted, fontSize: 9 }}>{l}</Text>)}
            </View>
        </View>
    );
}

// a plain horizontal bar with a label: used for foods and days of the week
export function HBar({ label, value, max, right, color }) {
    const { text, muted, primary } = useBrand();
    return (
        <View style={{ marginVertical: 5 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: text, fontWeight: '700', flex: 1 }} numberOfLines={1}>{label}</Text>
                <Text style={{ color: muted, fontWeight: '700' }}>{right}</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: alpha(muted, 0.18), marginTop: 4 }}>
                <View style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: color || primary }} />
            </View>
        </View>
    );
}
