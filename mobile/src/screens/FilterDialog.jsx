// src/screens/FilterDialog.jsx
import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useBrand } from '../ui/kit';
import { tint } from '../ui/shop';
import { useHomeStore } from '../store/useHomeStore';
import { useFilterStore, applyFilters } from '../store/useFilterStore';

const SORT_LABELS = {
    popularity: 'Popular',
    rating: 'Rating high to low',
    price_low: 'Price low to high',
    price_high: 'Price high to low',
    prep_time: 'Fastest delivery',
    newest: 'Newest',
};
const SORT_ORDER = ['popularity', 'rating', 'price_low', 'price_high', 'prep_time', 'newest'];

const TYPE_LABELS = [
    ['veg_only', 'Veg only'],
    ['egg_free', 'Eggless'],
    ['bestseller', 'Bestsellers'],
    ['offers', 'Has an offer'],
    ['rating_4', 'Rating 4.0+'],
    ['sugar_free', 'Sugar free'],
    ['jain', 'Jain'],
    ['gift_pack', 'Gift packs'],
    ['new', 'New'],
];

const PRICES = [[1, 'Under ₹150'], [2, '₹150 - ₹300'], [3, 'Above ₹300']];
const SPICES = [['mild', 'Mild'], ['medium', 'Medium'], ['hot', 'Hot']];
const SERVES = [2, 4, 6];

function Radio({ on, label, onPress }) {
    const { primary, text } = useBrand();
    return (
        <Pressable onPress={onPress} style={s.opt}>
            <View style={[s.radio, { borderColor: on ? primary : '#BBBBBB' }]}>
                {on ? <View style={[s.radioDot, { backgroundColor: primary }]} /> : null}
            </View>
            <Text style={[s.optTxt, { color: text }]}>{label}</Text>
        </Pressable>
    );
}

function Check({ on, label, onPress }) {
    const { primary, text } = useBrand();
    return (
        <Pressable onPress={onPress} style={s.opt}>
            <View style={[s.check, on ? { backgroundColor: primary, borderColor: primary } : { borderColor: '#BBBBBB' }]}>
                {on ? <Text style={s.tick}>✓</Text> : null}
            </View>
            <Text style={[s.optTxt, { color: text }]}>{label}</Text>
        </Pressable>
    );
}

function Pill({ on, label, onPress }) {
    const { primary, text } = useBrand();
    return (
        <Pressable
            onPress={onPress}
            style={[s.pill, on && { backgroundColor: tint(primary), borderColor: primary }]}
        >
            <Text style={[s.pillTxt, { color: on ? primary : text }]}>{label}</Text>
        </Pressable>
    );
}

function Title({ children }) {
    const { text } = useBrand();
    return <Text style={[s.h, { color: text }]}>{children}</Text>;
}

export default function FilterDialog({ visible, onClose, items }) {
    const { primary, radius, text } = useBrand();
    const config = useHomeStore((st) => st.config);
    const minCount = useHomeStore((st) => st.full.ratings.minCount);
    const f = useFilterStore();

    const filters = config.filters || [];
    const sorts = useMemo(
        () => SORT_ORDER.filter((id) => (config.sortOptions || []).includes(id)),
        [config.sortOptions],
    );
    const types = TYPE_LABELS.filter(([id]) => filters.includes(id));

    // weight chips come from the "weight" option group found in the menu items
    const weights = useMemo(() => {
        if (!filters.includes('weight')) return [];
        const seen = new Map();
        (items || []).forEach((p) => {
            (p.optionGroups || []).forEach((g) => {
                if (g.id !== 'weight') return;
                (g.options || []).forEach((o) => { if (!seen.has(o.id)) seen.set(o.id, o.name); });
            });
        });
        return [...seen.entries()];
    }, [items, filters]);

    const count = useMemo(
        () => applyFilters(items || [], f, minCount).length,
        [items, minCount, f.category, f.active, f.sort, f.price, f.spice, f.serves, f.weight],
    );

    const curSort = f.sort || 'popularity';
    const showSort = sorts.length > 1;

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={s.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={s.card}>
                    <View style={s.top}>
                        <Text style={[s.title, { color: text }]}>Filters</Text>
                        <Pressable onPress={() => f.clear()} hitSlop={10}>
                            <Text style={[s.clear, { color: primary }]}>Clear all</Text>
                        </Pressable>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
                        {showSort ? (
                            <View>
                                <Title>Sort by</Title>
                                {sorts.map((id) => (
                                    <Radio
                                        key={id}
                                        on={curSort === id}
                                        label={SORT_LABELS[id]}
                                        onPress={() => f.setSort(id === 'popularity' ? null : id)}
                                    />
                                ))}
                            </View>
                        ) : null}

                        {types.length ? (
                            <View>
                                <Title>Dish type</Title>
                                {types.map(([id, label]) => (
                                    <Check
                                        key={id}
                                        on={f.active.includes(id)}
                                        label={label}
                                        onPress={() => f.toggleFilter(id)}
                                    />
                                ))}
                            </View>
                        ) : null}

                        {filters.includes('price_range') ? (
                            <View>
                                <Title>Price</Title>
                                <View style={s.wrap}>
                                    {PRICES.map(([k, label]) => (
                                        <Pill key={k} on={f.price === k} label={label} onPress={() => f.setPrice(k)} />
                                    ))}
                                </View>
                            </View>
                        ) : null}

                        {filters.includes('spice_level') ? (
                            <View>
                                <Title>Spice</Title>
                                <View style={s.wrap}>
                                    {SPICES.map(([k, label]) => (
                                        <Pill key={k} on={f.spice === k} label={label} onPress={() => f.setSpice(k)} />
                                    ))}
                                </View>
                            </View>
                        ) : null}

                        {weights.length ? (
                            <View>
                                <Title>Weight</Title>
                                <View style={s.wrap}>
                                    {weights.map(([id, name]) => (
                                        <Pill key={id} on={f.weight === id} label={name} onPress={() => f.setWeight(id)} />
                                    ))}
                                </View>
                            </View>
                        ) : null}

                        {filters.includes('serves') ? (
                            <View>
                                <Title>Serves</Title>
                                <View style={s.wrap}>
                                    {SERVES.map((n) => (
                                        <Pill key={n} on={f.serves === n} label={`${n}+`} onPress={() => f.setServes(n)} />
                                    ))}
                                </View>
                            </View>
                        ) : null}
                    </ScrollView>

                    <Pressable onPress={onClose} style={[s.btn, { backgroundColor: primary, borderRadius: radius }]}>
                        <Text style={s.btnTxt}>Show {count} dish{count === 1 ? '' : 'es'}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 18 },
    card: { width: '100%', maxHeight: '82%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18 },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { fontSize: 18, fontWeight: '800' },
    clear: { fontSize: 13, fontWeight: '700' },
    h: { fontSize: 14, fontWeight: '800', marginTop: 14, marginBottom: 4 },
    opt: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
    optTxt: { fontSize: 14, marginLeft: 10 },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    check: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    tick: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', lineHeight: 15 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
    pill: { paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 18, marginRight: 8, marginBottom: 8 },
    pillTxt: { fontSize: 12, fontWeight: '600' },
    btn: { marginTop: 12, paddingVertical: 13, alignItems: 'center' },
    btnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});