import React from 'react';
import { View, StyleSheet } from 'react-native';
import RemoteImage from '../common/RemoteImage';
import PriceText from '../common/PriceText';
import ItemTitle from './ItemTitle';
import ItemMeta from './ItemMeta';

export default function CompactItemCard({ item, showDot }) {
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
        flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 10, borderRadius: 14,
        backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EEEEEE',
    },
    image: { width: 92, height: 92, borderRadius: 12 },
    body: { flex: 1, marginLeft: 12, justifyContent: 'center' },
    off: { opacity: 0.5 },
});