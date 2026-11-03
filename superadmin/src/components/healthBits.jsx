import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';

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
