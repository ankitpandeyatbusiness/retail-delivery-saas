import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, font } from '../theme';

// green / amber / red for the platform health: the colour, a soft background and a word, so it is not colour alone
export function useLevel() {
    const t = useTheme();
    return (level) => ({
        good: { color: t.success, soft: t.successSoft, word: 'Good' },
        warn: { color: t.warn, soft: t.warnSoft, word: 'Look' },
        bad: { color: t.danger, soft: t.dangerSoft, word: 'Act' },
    }[level] || { color: t.muted, soft: t.surfaceAlt, word: '' });
}

export function Dot({ level, size = 12 }) {
    const L = useLevel()(level);
    return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: L.color }} />;
}

// The shops behind a card: name and what is wrong, worst first. Tap one to open that shop.
export function ShopLines({ list, total, max = 5, onShop }) {
    const t = useTheme();
    if (!list || !list.length) return null;
    const shown = list.slice(0, max);
    const more = Math.max(0, (total || list.length) - shown.length);
    return (
        <View style={{ marginTop: spacing.sm }}>
            {shown.map((s) => (
                <Pressable key={s.id + s.detail} onPress={onShop ? () => onShop(s) : undefined} accessibilityRole={onShop ? 'button' : undefined} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.surfaceAlt }}>
                    <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>{s.name}</Text>
                    {s.detail ? <Text style={{ color: t.muted, fontSize: font.sm }}>{s.detail}</Text> : null}
                </Pressable>
            ))}
            {more > 0 ? <Text style={{ color: t.muted, fontSize: font.sm, paddingTop: 4 }}>{`and ${more} more`}</Text> : null}
        </View>
    );
}
