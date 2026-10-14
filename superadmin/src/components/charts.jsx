import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, spacing, font, tint } from '../theme';

/*
 * One series of bars (for example sales per day).
 * Follows the chart rules: ONE colour (one series), thin bars with rounded data-ends sitting on a baseline,
 * no gridlines, and only the first, last and highest values are written out. A table of every value belongs
 * under the chart (the screens add one), so nothing depends on colour or on reading bar heights.
 *
 *   data: [{ label: '01 Oct', value: 1250 }, ...]     format(value) -> text
 */
export default function BarChart({ data, color, height = 150, format = (v) => String(v) }) {
    const t = useTheme();
    const c = color || t.primary;
    if (!data?.length) return null;
    const max = Math.max(...data.map((d) => d.value), 1);
    const topIdx = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
    const labelled = new Set([0, data.length - 1, topIdx]);
    const gap = data.length > 40 ? 1 : data.length > 20 ? 2 : 4;

    return (
        <View>
            <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: t.border }}>
                {data.map((d, i) => {
                    const h = d.value > 0 ? Math.max(3, (d.value / max) * (height - 22)) : 0;
                    return (
                        <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', marginHorizontal: gap / 2 }}>
                            {labelled.has(i) && d.value > 0 ? (
                                <Text style={{ color: t.muted, fontSize: 10, fontWeight: '700', marginBottom: 2 }} numberOfLines={1}>{format(d.value)}</Text>
                            ) : null}
                            <View style={{ width: '100%', maxWidth: 28, height: h, backgroundColor: i === topIdx ? c : tint(c, 0.55), borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                        </View>
                    );
                })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={s.axis(t)}>{data[0].label}</Text>
                {data.length > 2 ? <Text style={s.axis(t)}>{data[Math.floor(data.length / 2)].label}</Text> : null}
                <Text style={s.axis(t)}>{data[data.length - 1].label}</Text>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    axis: (t) => ({ color: t.muted, fontSize: font.xs, fontWeight: '600' }),
});
