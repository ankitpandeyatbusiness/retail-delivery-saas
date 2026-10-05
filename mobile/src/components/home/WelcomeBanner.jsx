import React from 'react';
import { FlatList, useWindowDimensions } from 'react-native';
import { useHomeStore } from '../../store/useHomeStore';
import BannerCard from './BannerCard';

export default function WelcomeBanner() {
    const banners = useHomeStore((s) => s.banners);
    const { width } = useWindowDimensions();
    if (!banners.length) return null;

    return (
        <FlatList
            data={banners}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(b) => b._id}
            style={{ marginTop: 12 }}
            renderItem={({ item }) => <BannerCard banner={item} width={width} />}
        />
    );
}