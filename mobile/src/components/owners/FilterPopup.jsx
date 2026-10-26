// One filter look for the owner's lists, the same as the customer's Home filter: a funnel button (with the number of filters on), and a popup with
// a heading per group, round choice chips, "Clear all" at the top and one big button at the bottom. A list never shows its filter values in a row.
//   <FunnelButton count={n} onPress={open} />
//   <FilterPopup visible onClose title sections={[{ key, title, options: [[value, label]], value, onChange }]} onClear={fn} />
import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { tr } from '../../i18n';

export function FunnelButton({ count = 0, onPress, style }) {
    const { primary, onPrimary, surface, border } = useBrand();
    return (
        <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Filters')}
            style={[{ height: 46, width: 46, borderRadius: 14, borderWidth: 1, borderColor: count ? primary : border, backgroundColor: count ? alpha(primary, 0.12) : surface, alignItems: 'center', justifyContent: 'center' }, style]}>
            <Ionicons name={count ? 'funnel' : 'funnel-outline'} size={20} color={primary} />
            {count ? (
                <View style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: onPrimary, fontSize: 11, fontWeight: '900' }}>{count}</Text>
                </View>
            ) : null}
        </Pressable>
    );
}

function Chip({ on, label, onPress }) {
    const { primary, text, border } = useBrand();
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1.5, borderColor: on ? primary : border, backgroundColor: on ? alpha(primary, 0.14) : 'transparent' }}>
            <Text style={{ color: on ? primary : text, fontSize: 12.5, fontWeight: '700', textAlign: 'center' }}>{tr(label)}</Text>
        </Pressable>
    );
}

export function FilterPopup({ visible, onClose, title, sections, onClear, activeCount = 0 }) {
    const { primary, onPrimary, text, background, border, surface, radius } = useBrand();
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={{ flex: 1, justifyContent: 'center', padding: 18, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18 }}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={onClose} />
                <View style={{ backgroundColor: background, borderRadius: 22, padding: 18, maxHeight: '86%', elevation: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <Text style={{ color: text, fontSize: 19, fontWeight: '900', letterSpacing: -0.3 }}>{title || tr('Filters')}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {activeCount > 0 && onClear ? <Pressable onPress={onClear} hitSlop={10}><Text style={{ color: primary, fontSize: 13, fontWeight: '800', marginRight: 12 }}>{tr('Clear all')}</Text></Pressable> : null}
                            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Close')} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="close" size={16} color={text} />
                            </Pressable>
                        </View>
                    </View>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
                        {sections.map((x) => (
                            <View key={x.key}>
                                <Text style={{ color: text, fontSize: 14, fontWeight: '900', marginTop: 16, marginBottom: 4 }}>{tr(x.title)}</Text>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                                    {x.options.map(([v, label]) => <Chip key={String(v)} on={v === x.value} label={label} onPress={() => x.onChange(v)} />)}
                                </View>
                            </View>
                        ))}
                    </ScrollView>
                    <Pressable onPress={onClose} accessibilityRole="button" style={{ marginTop: 14, paddingVertical: 14, alignItems: 'center', borderRadius: radius ?? 14, backgroundColor: primary }}>
                        <Text style={{ color: onPrimary, fontSize: 15, fontWeight: '900' }}>{tr('Show results')}</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

// The whole thing in one piece for a simple list: a line saying what is shown, the funnel button, and the popup.
export function FilterBar({ title, summary, sections, activeCount = 0, onClear, style }) {
    const { muted, primary } = useBrand();
    const [open, setOpen] = React.useState(false);
    return (
        <View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 }, style]}>
            <Text style={{ flex: 1, paddingRight: 10, color: activeCount ? primary : muted, fontWeight: '800' }} numberOfLines={1}>{summary}</Text>
            <FunnelButton count={activeCount} onPress={() => setOpen(true)} />
            <FilterPopup visible={open} onClose={() => setOpen(false)} title={title} sections={sections} activeCount={activeCount} onClear={onClear} />
        </View>
    );
}
