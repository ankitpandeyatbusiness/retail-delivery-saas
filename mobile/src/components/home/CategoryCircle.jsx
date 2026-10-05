import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import RemoteImage from '../common/RemoteImage';
import { useThemeStore } from '../../store/useThemeStore';

function CategoryCircle({ category, selected, onPress }) {
    const primary = useThemeStore((s) => s.theme.colors.primary);
    return (
        <Pressable onPress={() => onPress(category._id)} style={styles.wrap}>
            <RemoteImage
                uri={category.image}
                style={[styles.image, selected && { borderColor: primary, borderWidth: 3 }]}
            />
            <Text style={[styles.name, selected && { color: primary, fontWeight: '700' }]} numberOfLines={1}>
                {category.name}
            </Text>
        </Pressable>
    );
}

export default React.memo(CategoryCircle);

const styles = StyleSheet.create({
    wrap: { width: 76, alignItems: 'center', marginRight: 6 },
    image: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: 'transparent' },
    name: { marginTop: 6, fontSize: 12, color: '#333333' },
});