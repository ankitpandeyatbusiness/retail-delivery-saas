// Delivery / Pickup / Dine in on the Home header: the highlight slides to the chosen one (like the Appearance switch), and the choice is
// handed on only after the slide has started, so the screen repaint never makes it stutter.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { tr } from '../../i18n';

const ICON = { delivery: 'bicycle-outline', pickup: 'basket-outline', dine_in: 'restaurant-outline' };
const NAME = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };

export default function ModeSlider({ modes, value, onChange, trackBg, trackLine, pillBg, onPill, idle }) {
    const [shown, setShown] = useState(value);
    const [w, setW] = useState(0);
    const idx = Math.max(0, modes.indexOf(shown));
    const slide = useRef(new Animated.Value(idx)).current;
    useEffect(() => { setShown(value); }, [value]);
    useEffect(() => {
        Animated.timing(slide, { toValue: Math.max(0, modes.indexOf(shown)), duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [shown, modes, slide]);
    const segW = w ? (w - 6) / modes.length : 0;
    const choose = (m) => {
        if (m === shown) return;
        setShown(m);
        setTimeout(() => onChange(m), 60);
    };
    return (
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', marginTop: 14, padding: 3, borderRadius: 14, backgroundColor: trackBg, borderWidth: 1, borderColor: trackLine }}>
            {segW ? <Animated.View style={{ position: 'absolute', left: 3, top: 3, bottom: 3, width: segW, borderRadius: 11, backgroundColor: pillBg, transform: [{ translateX: Animated.multiply(slide, segW) }] }} /> : null}
            {modes.map((m) => {
                const on = m === shown;
                return (
                    <Pressable key={m} onPress={() => choose(m)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
                        <Ionicons name={ICON[m]} size={16} color={on ? onPill : idle} />
                        <Text style={{ marginLeft: 6, fontWeight: '800', fontSize: 12.5, color: on ? onPill : idle }} numberOfLines={1}>{tr(NAME[m])}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
