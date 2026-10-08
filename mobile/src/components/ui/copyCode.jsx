// src/components/ui/copyCode.jsx
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useBrand } from './kit';
import { showToast } from './shop';


export async function copyCode(code) {
    try {
        await Clipboard.setStringAsync(String(code));
        showToast(`Code ${code} copied`);
        return true;
    } catch (e) {
        showToast('Could not copy the code');
        return false;
    }
}

function useCopied(code) {
    const [done, setDone] = useState(false);
    const pop = useRef(new Animated.Value(1)).current;
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const copy = async () => {
        if (!(await copyCode(code))) return;
        setDone(true);
        pop.setValue(0.6);
        Animated.spring(pop, { toValue: 1, friction: 4, tension: 200, useNativeDriver: true }).start();
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1600);
    };
    return { done, pop, copy };
}

// Small icon, used inside the coupon tickets on the home screen
export function CopyIcon({ code, color, size = 15, style }) {
    const { done, pop, copy } = useCopied(code);
    return (
        <Pressable onPress={copy} hitSlop={10} style={style}>
            <Animated.View style={{ transform: [{ scale: pop }] }}>
                <Ionicons name={done ? 'checkmark' : 'copy-outline'} size={size} color={done ? '#1E8E3E' : color} />
            </Animated.View>
        </Pressable>
    );
}

// Full button, used on the Offers screen instead of "Apply"
export function CopyButton({ code }) {
    const { primary, onPrimary, radius } = useBrand();
    const { done, pop, copy } = useCopied(code);
    return (
        <Pressable onPress={copy} style={[s.btn, { backgroundColor: done ? '#1E8E3E' : primary, borderRadius: radius }]}>
            <Animated.View style={[s.row, { transform: [{ scale: pop }] }]}>
                <Ionicons name={done ? 'checkmark' : 'copy-outline'} size={15} color={onPrimary} />
                <Text style={[s.txt, { color: onPrimary }]}>{done ? 'Copied' : 'Copy'}</Text>
            </Animated.View>
        </Pressable>
    );
}

const s = StyleSheet.create({
    btn: { paddingHorizontal: 16, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', minWidth: 92 },
    row: { flexDirection: 'row', alignItems: 'center' },
    txt: { fontSize: 13, fontWeight: '800', marginLeft: 6 },
});