// "By dish": everything still to make, added up across orders, so a cook can batch it: "5× Burger, 3× Fries". Orders that are only waiting and
// orders already being cooked are both counted (the cook decides what to fire together). Same dish with different choices stays apart.
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Empty } from '../owners/ui';
import { VegDot } from '../customers/shop';
import { tr } from '../../i18n';

export function totalsOf(orders) {
    const map = new Map();
    for (const o of orders) {
        for (const l of o.items) {
            const key = `${l.productId}|${l.options.join(',')}|${l.measure || ''}`;
            const cur = map.get(key) || { key, name: l.name, options: l.options, measure: l.measure, isVeg: l.isVeg, qty: 0, orders: new Set(), cooking: 0, notes: new Map() };
            cur.qty += l.measure ? 1 : l.quantity;
            cur.orders.add(o.id);
            if (o.stage === 'cooking') cur.cooking += l.measure ? 1 : l.quantity;
            if (l.note) cur.notes.set(l.note, (cur.notes.get(l.note) || 0) + 1);
            map.set(key, cur);
        }
    }
    return [...map.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

export default function DishTotals({ orders }) {
    const { surface, border, text, muted, primary, warn } = useBrand();
    const rows = useMemo(() => totalsOf(orders), [orders]);
    if (!rows.length) return <Empty icon="restaurant-outline" title={tr('Nothing to make')} hint={tr('New orders appear here by themselves, with a sound.')} />;
    return (
        <View style={{ marginHorizontal: 16 }}>
            {rows.map((r) => (
                <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: surface, borderColor: border, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 10 }}>
                    <View style={{ minWidth: 62, height: 52, borderRadius: 14, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12, paddingHorizontal: 8 }}>
                        <Text style={{ color: primary, fontWeight: '900', fontSize: 26 }}>{r.qty}×</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {r.isVeg !== null && r.isVeg !== undefined ? <View style={{ marginRight: 6 }}><VegDot isVeg={r.isVeg} /></View> : null}
                            <Text style={{ color: text, fontWeight: '900', fontSize: 17, flexShrink: 1 }}>{r.measure ? `${r.measure} ` : ''}{r.name}</Text>
                        </View>
                        {r.options.length ? <Text style={{ color: muted, fontWeight: '600', fontSize: 13.5 }}>{r.options.join(' · ')}</Text> : null}
                        <Text style={{ color: muted, fontWeight: '700', fontSize: 12.5, marginTop: 2 }}>
                            {r.orders.size === 1 ? tr('in 1 order') : tr('in {n} orders', { n: r.orders.size })}
                            {r.cooking > 0 ? ` · ${tr('{n} already cooking', { n: r.cooking })}` : ''}
                        </Text>
                        {[...r.notes.keys()].slice(0, 3).map((n) => <Text key={n} style={{ color: warn, fontWeight: '800', fontSize: 12.5 }}>{n}</Text>)}
                    </View>
                </View>
            ))}
        </View>
    );
}
