// Pieces of the cook's and the waiter's pages on a computer: a board (columns side by side, each scrolling by itself) and a column with a coloured header.
// Used only when useStaffDesktop() is true.
import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';

// the columns in a row, as high as the page; sideways scroll when the window is narrow
export function Board({ children }) {
    return (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ minWidth: '100%', height: '100%', paddingHorizontal: 16, paddingBottom: 16 }} showsHorizontalScrollIndicator={false}>
            {children}
        </ScrollView>
    );
}

// one column: a coloured header (icon, title, count) and the cards under it
export function Column({ title, icon, color, count, width, children, emptyText, emptyIcon, hint }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ flex: width ? undefined : 1, width, minWidth: width || 310, marginHorizontal: 8, borderRadius: 22, backgroundColor: alpha(color, 0.07), borderWidth: 1, borderColor: alpha(color, 0.2), overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, backgroundColor: alpha(color, 0.13) }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={17} color="#FFFFFF" /></View>
                <View style={{ flex: 1, marginLeft: 10, minWidth: 0 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 15.5 }} numberOfLines={1}>{title}</Text>
                    {hint ? <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700' }} numberOfLines={1}>{hint}</Text> : null}
                </View>
                {count != null ? <View style={{ minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: count ? color : alpha(muted, 0.2) }}><Text style={{ fontWeight: '900', fontSize: 13, color: count ? '#FFFFFF' : muted }}>{count}</Text></View> : null}
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
                {children}
                {count === 0 && emptyText ? (
                    <View style={{ alignItems: 'center', paddingVertical: 44 }}>
                        <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: alpha(color, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={emptyIcon || `${icon}-outline`} size={26} color={alpha(color, 0.8)} /></View>
                        <Text style={{ color: muted, fontSize: 13.5, fontWeight: '700', marginTop: 10, textAlign: 'center' }}>{emptyText}</Text>
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}
