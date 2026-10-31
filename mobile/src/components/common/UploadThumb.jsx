// A picture on its way: the thumbnail, dimmed, with a round loader that fills as it goes (like WhatsApp) and a cross in the middle that stops it.
// progress: 0..1, or null while the first bytes have not gone yet (the ring then spins). Drawn from plain views, so it needs no extra package.
import React, { useEffect, useRef } from 'react';
import { View, Pressable, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

const RING = 40;
const W = 4;

// half rings clipped to the right and the left half; each is turned to show its share of the circle
function Ring({ p }) {
    const deg = Math.max(0, Math.min(1, p)) * 360;
    const right = Math.min(deg, 180);
    const left = Math.max(deg - 180, 0);
    const half = { position: 'absolute', top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: W, borderColor: 'transparent' };
    return (
        <View style={{ width: RING, height: RING }}>
            <View style={{ position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: W, borderColor: 'rgba(255,255,255,0.3)' }} />
            <View style={{ position: 'absolute', left: RING / 2, top: 0, width: RING / 2, height: RING, overflow: 'hidden' }}>
                <View style={[half, { left: -RING / 2, borderTopColor: '#fff', borderRightColor: '#fff', transform: [{ rotate: `${right - 135}deg` }] }]} />
            </View>
            <View style={{ position: 'absolute', left: 0, top: 0, width: RING / 2, height: RING, overflow: 'hidden' }}>
                <View style={[half, { left: 0, borderBottomColor: '#fff', borderLeftColor: '#fff', transform: [{ rotate: `${left - 135}deg` }] }]} />
            </View>
        </View>
    );
}

export default function UploadThumb({ uri, progress, onCancel, size = 84, radius = 12 }) {
    const spin = useRef(new Animated.Value(0)).current;
    const waiting = progress === null || progress === undefined;
    useEffect(() => {
        if (!waiting) return undefined;
        const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
        loop.start();
        return () => loop.stop();
    }, [waiting, spin]);
    return (
        <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri }} style={{ position: 'absolute', width: size, height: size }} contentFit="cover" />
            <View style={{ position: 'absolute', width: size, height: size, backgroundColor: 'rgba(0,0,0,0.45)' }} />
            {waiting ? (
                <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}><Ring p={0.28} /></Animated.View>
            ) : <Ring p={Math.max(progress, 0.04)} />}
            <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button" style={{ position: 'absolute', width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={18} color="#FFFFFF" />
            </Pressable>
        </View>
    );
}
