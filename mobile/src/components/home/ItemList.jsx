import React, { useCallback } from 'react';
import { ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useHomeStore } from '../../store/useHomeStore';
import useProducts from '../../hooks/useProducts';
import ItemCard from '../cards/ItemCard';
import HomeBlocks from './HomeBlocks';
import ListStatus from './ListStatus';

export default function ItemList() {
    const cardStyle = useHomeStore((s) => s.config.cardStyle);
    const showDot = useHomeStore((s) => s.config.showVegDot);
    const { items, loading, error, loadMore, reload } = useProducts();

    const renderItem = useCallback(
        ({ item }) => <ItemCard item={item} cardStyle={cardStyle} showDot={showDot} />,
        [cardStyle, showDot]
    );

    return (
        <FlashList
            key={cardStyle}
            data={items}
            renderItem={renderItem}
            keyExtractor={(item) => item._id}
            numColumns={cardStyle === 'grid' ? 2 : 1}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            ListHeaderComponent={HomeBlocks}
            ListEmptyComponent={<ListStatus loading={loading} error={error} onRetry={reload} />}
            ListFooterComponent={loading && items.length ? <ActivityIndicator style={{ margin: 16 }} /> : null}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
        />
    );
}