// System / Light / Dark, moving exactly like the customer app's Account page: the highlight slides to the chosen choice, and
// the whole app glides into the new colours only AFTER the highlight has finished, so the repaint can never make the slide stutter.
// The choice is kept on this phone.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, smoothTheme, alpha } from '../common/kit';
import { useThemeStore } from '../../store/common/useThemeStore';
import { tr } from '../../i18n';

const MODES = [['system', 'phone-portrait-outline', 'System'], ['light', 'sunny-outline', 'Light'], ['dark', 'moon-outline', 'Dark']];

export default function AppearanceSwitch({ last }) {
    const { primary, onPrimary, text, muted, border, background } = useBrand();
    const saved = useThemeStore((st) => st.appearance);
    const setAppearance = useThemeStore((st) => st.setAppearance);
    // what the control draws is local and changes the instant it is tapped
    const [mode, setMode] = useState(saved);
    const idx = Math.max(0, MODES.findIndex((m) => m[0] === mode));
    const [w, setW] = useState(0);
    const slide = useRef(new Animated.Value(idx)).current;
    useEffect(() => { setMode(saved); }, [saved]);

    const choose = (id) => {
        if (id === mode) return;
        setMode(id);
        Animated.timing(slide, { toValue: MODES.findIndex((m) => m[0] === id), duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        // the colours start gliding into the new look at once, together with the highlight
        setTimeout(() => smoothTheme(() => setAppearance(id)), 40);
    };
    const segW = w ? (w - 6) / MODES.length : 0;

    return (
        <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[styles.ic, { backgroundColor: alpha(primary, 0.14) }]}><Ionicons name="contrast-outline" size={18} color={primary} /></View>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: text, fontSize: 15, fontWeight: '800' }}>{tr('Appearance')}</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{mode === 'system' ? tr('Follows your phone\'s dark mode') : mode === 'dark' ? tr('Always dark') : tr('Always light')}</Text>
                </View>
            </View>
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[styles.seg, { backgroundColor: background, borderColor: border }]}>
                {segW ? <Animated.View style={[styles.pill, { width: segW, backgroundColor: primary, transform: [{ translateX: Animated.multiply(slide, segW) }] }]} /> : null}
                {MODES.map(([id, icon, label]) => {
                    const on = id === mode;
                    return (
                        <Pressable key={id} onPress={() => choose(id)} style={styles.item} accessibilityRole="button" accessibilityState={{ selected: on }}>
                            <Ionicons name={icon} size={15} color={on ? onPrimary : muted} />
                            <Text style={{ color: on ? onPrimary : muted, fontSize: 12.5, fontWeight: '800', marginLeft: 5 }}>{label}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { paddingVertical: 12 },
    ic: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    seg: { flexDirection: 'row', height: 40, borderRadius: 12, borderWidth: 1, padding: 3, marginTop: 12 },
    pill: { position: 'absolute', left: 3, top: 3, bottom: 3, borderRadius: 9 },
    item: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
