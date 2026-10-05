import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RemoteImage from '../common/RemoteImage';
import { useThemeStore } from '../../store/useThemeStore';

export default function BannerCard({ banner, width }) {
    const primary = useThemeStore((s) => s.theme.colors.primary);
    return (
        <View style={{ width, paddingHorizontal: 16 }}>
            <View style={[styles.card, { backgroundColor: primary }]}>
                {banner.image ? <RemoteImage uri={banner.image} style={StyleSheet.absoluteFill} /> : null}
                <View style={styles.textBox}>
                    {banner.title ? <Text style={styles.title}>{banner.title}</Text> : null}
                    {banner.subtitle ? <Text style={styles.subtitle}>{banner.subtitle}</Text> : null}
                    {banner.couponCode ? (
                        <View style={styles.code}><Text style={styles.codeText}>{banner.couponCode}</Text></View>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { height: 140, borderRadius: 16, overflow: 'hidden', justifyContent: 'center' },
    textBox: { padding: 16 },
    title: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
    subtitle: { fontSize: 14, color: '#FFFFFF', marginTop: 2 },
    code: { alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.9)' },
    codeText: { fontSize: 12, fontWeight: '800', color: '#333333', letterSpacing: 1 },
});