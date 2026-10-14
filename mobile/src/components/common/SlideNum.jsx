// src/components/ui/SlideNum.jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing } from 'react-native';

// Number that slides out and the new one slides in (up when it grows, down when it shrinks)
export default function SlideNum({ value, style, minWidth = 26 }) {
    const [shown, setShown] = useState(value);
    const y = useRef(new Animated.Value(0)).current;
    const op = useRef(new Animated.Value(1)).current;
    const prev = useRef(value);
    useEffect(() => {
        if (value === prev.current) return;
        const dir = value > prev.current ? 1 : -1;
        prev.current = value;
        Animated.parallel([
            Animated.timing(y, { toValue: -12 * dir, duration: 110, easing: Easing.in(Easing.quad), useNativeDriver: true }),
            Animated.timing(op, { toValue: 0, duration: 110, useNativeDriver: true }),
        ]).start(({ finished }) => {
            if (!finished) return;          // a faster tap took over
            setShown(prev.current);
            y.setValue(12 * dir);
            Animated.parallel([
                Animated.timing(y, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                Animated.timing(op, { toValue: 1, duration: 180, useNativeDriver: true }),
            ]).start();
        });
    }, [value]);
    return (
        <View style={{ overflow: 'hidden', minWidth, alignItems: 'center' }}>
            <Animated.Text style={[style, { opacity: op, transform: [{ translateY: y }] }]}>{shown}</Animated.Text>
        </View>
    );
}