import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { animateNext } from './motion';

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

// One line of "Needs you": the problem, and, when shops are behind it, a smooth drop-down with those shops. Tap the line to open or close it.
// Without shops the tap goes straight to `onOpen`. Inside the drop-down, "See details" goes to `onOpen` too.
export function NeedItem({ level, title, hint, list, total, max = 5, onShop, onOpen, open, onToggle, first }) {
    const t = useTheme();
    const has = !!(list && list.length);
    const tap = () => { if (!has) { onOpen?.(); return; } animateNext(); onToggle?.(); };
    return (
        <View style={{ paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: t.surfaceAlt }}>
            <Pressable onPress={tap} accessibilityRole="button" accessibilityState={has ? { expanded: !!open } : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Dot level={level} />
                <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '700' }}>{title}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm }}>{hint}</Text>
                </View>
                {has ? <Text style={{ color: t.muted, fontSize: font.sm }}>{(total || list.length)}</Text> : null}
                <Text style={{ color: t.muted, fontSize: font.lg, transform: [{ rotate: has && open ? '90deg' : '0deg' }] }}>›</Text>
            </Pressable>
            {has && open ? (
                <View>
                    <ShopLines list={list} total={total} max={max} onShop={onShop} />
                    {onOpen ? (
                        <Pressable onPress={onOpen} accessibilityRole="button" style={{ paddingTop: 8 }}>
                            <Text style={{ color: t.primary, fontWeight: '700' }}>See details ›</Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}
