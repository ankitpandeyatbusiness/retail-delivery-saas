// One filter look for the lists, the same as the shop app's: a funnel button (with the number of filters on) and a popup with a heading per group,
// round choice chips, "Clear all" at the top and one big button at the bottom. A list never shows its filter values in a row.
//   <FunnelButton count={n} onPress={open} />
//   <FilterPopup visible onClose title sections={[{ key, title, options: [[value, label]], value, onChange } | { key, title, row: 'Shown value', onPress }]} onClear activeCount />
import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, font } from '../theme';
import Icon from './Icon';

export function FunnelButton({ count = 0, onPress }) {
    const t = useTheme();
    return (
        <Pressable
            onPress={onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Filters"
            style={({ pressed }) => ({ height: 46, width: 46, borderRadius: 14, borderWidth: 1, borderColor: count ? t.primary : t.border, backgroundColor: count ? t.primarySoft || t.surface : t.surface, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
            <Icon name="funnel" size={20} color={t.primary} />
            {count ? (
                <View style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900' }}>{count}</Text>
                </View>
            ) : null}
        </Pressable>
    );
}

function Pill({ on, label, onPress }) {
    const t = useTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({ marginRight: 8, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1.5, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : t.surface, transform: [{ scale: pressed ? 0.96 : 1 }] })}
        >
            <Text style={{ color: on ? '#FFFFFF' : t.text, fontSize: font.sm, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
        </Pressable>
    );
}

export function FilterPopup({ visible, onClose, title = 'Filters', sections, onClear, activeCount = 0 }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={{ flex: 1, justifyContent: 'center', padding: 18, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18 }}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={onClose} />
                <View style={{ backgroundColor: t.surface, borderRadius: 22, padding: 18, maxHeight: '86%', elevation: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <Text style={{ color: t.text, fontSize: 19, fontWeight: '900' }}>{title}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {activeCount > 0 && onClear ? (
                                <Pressable onPress={onClear} hitSlop={10}><Text style={{ color: t.primary, fontSize: font.sm, fontWeight: '800', marginRight: 12 }}>Clear all</Text></Pressable>
                            ) : null}
                            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="clear" size={16} color={t.text} />
                            </Pressable>
                        </View>
                    </View>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
                        {sections.map((x) => (
                            <View key={x.key}>
                                <Text style={{ color: t.text, fontSize: font.md, fontWeight: '900', marginTop: 16, marginBottom: 4 }}>{x.title}</Text>
                                {x.row !== undefined ? (
                                    <Pressable
                                        onPress={x.onPress}
                                        style={({ pressed }) => ({ marginTop: 6, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: x.active ? t.primary : t.border, backgroundColor: t.surface, transform: [{ scale: pressed ? 0.98 : 1 }] })}
                                    >
                                        <Text style={{ flex: 1, color: x.active ? t.primary : t.text, fontSize: font.md, fontWeight: '700' }} numberOfLines={1}>{x.row}</Text>
                                        <Icon name="next" size={16} color={t.muted} />
                                    </Pressable>
                                ) : (
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                                        {x.options.map(([v, label]) => <Pill key={String(v)} on={v === x.value} label={label} onPress={() => x.onChange(v)} />)}
                                    </View>
                                )}
                            </View>
                        ))}
                    </ScrollView>
                    <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 14, paddingVertical: 14, alignItems: 'center', borderRadius: 14, backgroundColor: t.primary, opacity: pressed ? 0.9 : 1 })}>
                        <Text style={{ color: '#FFFFFF', fontSize: font.md + 1, fontWeight: '900' }}>Show results</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}
