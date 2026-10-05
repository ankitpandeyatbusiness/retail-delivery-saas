import React from 'react';
import { FlatList } from 'react-native';
import { useHomeStore } from '../../store/useHomeStore';
import OfferCard from './OfferCard';

export default function OffersStrip() {
    const offers = useHomeStore((s) => s.offers);
    if (!offers.length) return null;

    return (
        <FlatList
            data={offers}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(o) => o._id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
            renderItem={({ item }) => <OfferCard offer={item} />}
        />
    );
}