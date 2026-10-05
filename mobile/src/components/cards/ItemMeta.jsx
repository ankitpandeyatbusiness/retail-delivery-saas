import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RatingBadge from '../common/RatingBadge';

export default function ItemMeta({ item }) {
    return (
        <View style={styles.row}>
            <RatingBadge rating={item.rating} />
            {item.prepTimeMin ? <Text style={styles.time}>{item.prepTimeMin} min</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    time: { fontSize: 12, color: '#777777' },
});