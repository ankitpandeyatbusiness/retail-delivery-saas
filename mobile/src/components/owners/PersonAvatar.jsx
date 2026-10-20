// A customer's profile photo (a person icon when there is none).
import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';

export default function PersonAvatar({ photo, size = 36 }) {
    const { muted } = useBrand();
    if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(muted, 0.2) }} contentFit="cover" />;
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(muted, 0.18), alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="person" size={size * 0.55} color={muted} />
        </View>
    );
}
