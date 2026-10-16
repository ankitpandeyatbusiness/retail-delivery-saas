// The owner panel's loading placeholders: grey shapes with a light sweep (the customer app's Skel), instead of spinners.
// ListShimmer = cards or rows of a list. FormShimmer = a form. StatShimmer = a big number and a few lines.
import React from 'react';
import { View } from 'react-native';
import { useBrand } from '../common/kit';
import { Skel } from '../common/motion';

const widths = [['46%', '78%'], ['58%', '64%'], ['38%', '86%'], ['52%', '70%']];

// cards like the order / complaint / coupon cards
export function ListShimmer({ count = 4, rows = false }) {
    const { surface, border } = useBrand();
    return (
        <View style={{ paddingTop: 4 }}>
            {Array.from({ length: count }).map((_, i) => (
                rows ? (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
                        <Skel width={42} height={42} radius={21} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Skel width={widths[i % 4][0]} height={14} />
                            <Skel width={widths[i % 4][1]} height={11} style={{ marginTop: 9 }} />
                        </View>
                    </View>
                ) : (
                    <View key={i} style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Skel width={widths[i % 4][0]} height={15} />
                            <View style={{ flex: 1 }} />
                            <Skel width={54} height={20} radius={10} />
                        </View>
                        <Skel width={widths[i % 4][1]} height={12} style={{ marginTop: 12 }} />
                        <Skel width="40%" height={11} style={{ marginTop: 10 }} />
                    </View>
                )
            ))}
        </View>
    );
}

// a form: a few cards, each with a title and some fields
export function FormShimmer({ cards = 3 }) {
    const { surface, border } = useBrand();
    return (
        <View style={{ paddingTop: 6 }}>
            {Array.from({ length: cards }).map((_, c) => (
                <View key={c}>
                    <Skel width="34%" height={16} style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 12 }} />
                    <View style={{ marginHorizontal: 16, marginBottom: 14, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                        {[0, 1].map((i) => (
                            <View key={i} style={{ marginBottom: i ? 0 : 16 }}>
                                <Skel width="30%" height={12} />
                                <Skel width="100%" height={46} radius={12} style={{ marginTop: 8 }} />
                            </View>
                        ))}
                    </View>
                </View>
            ))}
        </View>
    );
}

// a big figure with a few rows under it (money, closing report, performance)
export function StatShimmer() {
    const { surface, border } = useBrand();
    return (
        <View style={{ paddingTop: 6 }}>
            <View style={{ marginHorizontal: 16, marginBottom: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                <Skel width="32%" height={12} />
                <Skel width="55%" height={34} radius={10} style={{ marginTop: 10 }} />
                <View style={{ flexDirection: 'row', marginTop: 16 }}>
                    {[0, 1, 2].map((i) => <View key={i} style={{ flex: 1, marginRight: i < 2 ? 12 : 0 }}><Skel width="60%" height={11} /><Skel width="80%" height={18} style={{ marginTop: 8 }} /></View>)}
                </View>
            </View>
            <ListShimmer count={2} />
        </View>
    );
}

// one line of text while a small thing loads (a number, a name)
export function LineShimmer({ width = 80, height = 14 }) {
    return <Skel width={width} height={height} />;
}
