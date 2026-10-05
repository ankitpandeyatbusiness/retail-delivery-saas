import React from 'react';
import { FlatList } from 'react-native';
import { useHomeStore } from '../../store/useHomeStore';
import { useFilterStore } from '../../store/useFilterStore';
import CategoryCircle from './CategoryCircle';

export default function CategoryRow() {
    const categories = useHomeStore((s) => s.categories);
    const selected = useFilterStore((s) => s.category);
    const setCategory = useFilterStore((s) => s.setCategory);
    if (!categories.length) return null;

    return (
        <FlatList
            data={categories}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(c) => c._id}
            extraData={selected}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12 }}
            renderItem={({ item }) => (
                <CategoryCircle category={item} selected={selected === item._id} onPress={setCategory} />
            )}
        />
    );
}