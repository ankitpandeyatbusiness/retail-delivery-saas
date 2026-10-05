import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';

export default function SearchBar() {
    return (
        <Pressable style={styles.bar}>
            <Text style={styles.text}>🔍  Search for dishes</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    bar: { marginHorizontal: 16, marginTop: 4, height: 46, borderRadius: 12, backgroundColor: '#F4F4F4', justifyContent: 'center', paddingHorizontal: 14 },
    text: { fontSize: 15, color: '#8A8A8A' },
});