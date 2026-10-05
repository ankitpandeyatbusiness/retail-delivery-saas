import React from 'react';
import { View, StyleSheet } from 'react-native';
import RemoteImage from '../common/RemoteImage';
import PriceText from '../common/PriceText';
import ItemTitle from './ItemTitle';
import ItemMeta from './ItemMeta';

export default function BigItemCard({ item, showDot }) {
    return (
        <View style={[styles.card, !item.isAvailable && styles.off]}>
            <RemoteImage uri={item.image} style={styles.image} />
            <View style={styles.body}>
                <ItemTitle item={item} showDot={showDot} />
                <ItemMeta item={item} />
                <PriceText price={item.price} mrp={item.mrp} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 16, marginBottom: 16, borderRadius: 16, overflow: 'hidden',
        backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EEEEEE',
    },
    image: { width: '100%', height: 170 },
    body: { padding: 12 },
    off: { opacity: 0.5 },
});