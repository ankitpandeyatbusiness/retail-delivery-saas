// The cards on the waiter's screen: a dish to serve, a table's request, and a table. Colours come from the shop's theme, so they follow the
// light and dark look; a dish that waited too long and a request that waited too long turn red.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { money } from '../owners/ui';
import { BigButton, useMinuteClock, minsSince, minWord } from './staffBits';
import { tr } from '../../i18n';

const Chip = ({ icon, text, color }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: alpha(color, 0.14) }}>
        <Ionicons name={icon} size={13} color={color} style={{ marginRight: 4 }} />
        <Text style={{ color, fontWeight: '800', fontSize: 13 }}>{text}</Text>
    </View>
);

// one ready round: "Table 4 · #1042 · 2× Dosa", and the Served button
export function ServeCard({ o, lateMin, busy, onServe }) {
    const { surface, border, text, muted, primary, ok, error, warn } = useBrand();
    useMinuteClock();
    const mins = minsSince(o.readyAt);
    const late = mins >= lateMin;
    return (
        <View style={{ backgroundColor: surface, borderColor: late ? alpha(error, 0.55) : border, borderWidth: late ? 1.5 : 1, borderLeftColor: late ? error : ok, borderLeftWidth: 5, borderRadius: 18, padding: 14, marginHorizontal: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: text, fontSize: 26, fontWeight: '900' }}>{o.table ? tr('Table {n}', { n: o.table }) : tr('Dine in')}</Text>
                <View style={{ flex: 1 }} />
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: late ? error : text, fontWeight: '900', fontSize: 16 }}>{minWord(mins)}</Text>
                    <Text style={{ color: late ? error : muted, fontSize: 11.5, fontWeight: '700' }}>{late ? tr('Waiting too long') : tr('Ready')}</Text>
                </View>
            </View>
            <Text style={{ color: muted, fontWeight: '700', marginTop: 2 }}>#{o.orderNo}</Text>
            <View style={{ marginTop: 8 }}>
                {o.items.map((l, i) => (
                    <View key={i} style={{ flexDirection: 'row', paddingVertical: 5, borderTopWidth: i ? 0.5 : 0, borderTopColor: border }}>
                        <Text style={{ width: 44, color: primary, fontWeight: '900', fontSize: 20 }}>{l.measure ? '' : `${l.quantity}×`}</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 16.5 }}>{l.measure ? `${l.measure} ` : ''}{l.name}</Text>
                            {l.options.length ? <Text style={{ color: muted, fontWeight: '600', fontSize: 13.5 }}>{l.options.join(' · ')}</Text> : null}
                            {l.note ? <Text style={{ color: warn, fontWeight: '800', fontSize: 13.5, marginTop: 2 }}>{l.note}</Text> : null}
                        </View>
                    </View>
                ))}
            </View>
            {o.note ? <Text style={{ color: warn, fontWeight: '700', marginTop: 6 }}>{o.note}</Text> : null}
            <View style={{ marginTop: 12 }}>
                <BigButton label={tr('Served')} icon="checkmark-done" bg={ok} ink="#FFFFFF" busy={busy} onPress={onServe} />
            </View>
        </View>
    );
}

const KIND_ICON = { waiter: 'hand-left', water: 'water', cutlery: 'restaurant', clean: 'sparkles', other: 'help-buoy', bill: 'receipt' };

// what a table asks for: a call (Done) or the bill (Open the bill)
export function RequestCard({ q, busy, lateMin, onDone, onOpenBill }) {
    const { surface, border, text, muted, primary, ok, error, warn } = useBrand();
    useMinuteClock();
    const mins = minsSince(q.at);
    const late = mins >= (q.type === 'bill' ? lateMin : lateMin * 2);
    const c = q.type === 'bill' ? warn : primary;
    return (
        <View style={{ backgroundColor: surface, borderColor: late ? alpha(error, 0.55) : border, borderWidth: late ? 1.5 : 1, borderRadius: 18, padding: 14, marginHorizontal: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: alpha(c, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Ionicons name={KIND_ICON[q.kind] || 'help-buoy'} size={24} color={c} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: text, fontSize: 19, fontWeight: '900' }}>{tr('Table {n}', { n: q.table })}</Text>
                    <Text style={{ color: text, fontWeight: '700', fontSize: 15 }}>{tr(q.label)}{q.text ? `: ${q.text}` : ''}</Text>
                </View>
                <Text style={{ color: late ? error : muted, fontWeight: '900' }}>{minWord(mins)}</Text>
            </View>
            <View style={{ marginTop: 12 }}>
                {q.type === 'bill'
                    ? <BigButton label={tr('Open the bill')} icon="receipt" bg={warn} ink="#1A1A1A" onPress={onOpenBill} />
                    : <BigButton label={tr('Done')} icon="checkmark" bg={ok} ink="#FFFFFF" busy={busy} onPress={onDone} />}
            </View>
        </View>
    );
}

const STATE = { free: ['Free', 'ellipse-outline'], eating: ['Eating', 'restaurant'], bill_asked: ['Bill', 'receipt'] };

// one table in the grid: its number, its state, and what needs the waiter
export function TableCell({ t, onPress, cols = 3 }) {
    const { surface, border, text, muted, primary, warn, ok } = useBrand();
    const free = t.state === 'free';
    const bill = t.state === 'bill_asked';
    const c = free ? muted : bill ? warn : primary;
    return (
        <Pressable onPress={onPress} disabled={free} accessibilityRole="button" style={({ pressed }) => ({ width: `${(100 - (cols - 1) * 2) / cols}%`, marginBottom: 10, padding: 10, borderRadius: 16, backgroundColor: free ? surface : alpha(c, 0.12), borderWidth: free ? 1 : 1.5, borderColor: free ? border : alpha(c, 0.7), opacity: pressed ? 0.8 : 1 })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: free ? muted : text, fontSize: 22, fontWeight: '900', flex: 1 }}>{t.table}</Text>
                <Ionicons name={STATE[t.state]?.[1] || 'ellipse-outline'} size={16} color={c} />
            </View>
            <Text style={{ color: c, fontWeight: '800', fontSize: 12, marginTop: 2 }}>{tr(STATE[t.state]?.[0] || 'Free')}</Text>
            {!free ? <Text style={{ color: text, fontWeight: '800', fontSize: 13, marginTop: 4 }}>{t.due > 0 ? money(t.due) : tr('Paid')}</Text> : <Text style={{ fontSize: 13, marginTop: 4 }}> </Text>}
            <View style={{ flexDirection: 'row', marginTop: 4, minHeight: 18 }}>
                {t.ready > 0 ? <Badge color={ok} text={`${t.ready}`} icon="checkmark-done" /> : null}
                {t.cooking > 0 ? <Badge color={muted} text={`${t.cooking}`} icon="flame" /> : null}
                {t.requests > 0 ? <Badge color={warn} text={`${t.requests}`} icon="hand-left" /> : null}
            </View>
        </Pressable>
    );
}

const Badge = ({ color, text, icon }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
        <Ionicons name={icon} size={12} color={color} />
        <Text style={{ color, fontWeight: '900', fontSize: 12, marginLeft: 2 }}>{text}</Text>
    </View>
);

export { Chip };
