import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeStore } from '../store/useThemeStore';
import { useHomeStore } from '../store/useHomeStore';
import HomeHeader from '../components/home/HomeHeader';
import ItemList from '../components/home/ItemList';

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const background = useThemeStore((s) => s.theme.colors.background);
    const load = useHomeStore((s) => s.load);

    useEffect(() => { load(); }, [load]);

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <HomeHeader />
            <ItemList />
        </View>
    );
}