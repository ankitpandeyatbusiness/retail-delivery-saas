// The slim rows of the cook's, the waiter's and the rider's sidebar under their main pages: shortcuts to what used to sit only on the Profile page (Alerts, Soundbox,
// days off, where you are logged in...) and Log out at the bottom. The same look as the owner's side menu: a small icon tile and a name, the page you are on lit up,
// a rounded hover; folded, only the tile. Never drawn on the phone (the sidebars are only mounted on the desktop website).
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from './kit';

export function SideGroupTitle({ children }) {
    const { muted } = useBrand();
    return <Text style={{ color: muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: 4, marginBottom: 6, paddingHorizontal: 8 }}>{String(children).toUpperCase()}</Text>;
}

export function SideRow({ icon, title, note, color, active, compact, onPress }) {
    const { primary, onPrimary, text, muted } = useBrand();
    const tint = color || primary;
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
            style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', minHeight: compact ? 44 : 42, borderRadius: 14, paddingVertical: 5, paddingHorizontal: compact ? 0 : 8, marginBottom: 2, backgroundColor: active ? alpha(primary, 0.13) : hovered ? alpha(muted, 0.12) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '120ms' })}>
            {active && !compact ? <View style={{ position: 'absolute', left: -4, top: 10, bottom: 10, width: 4, borderRadius: 2, backgroundColor: primary }} /> : null}
            <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: active ? primary : alpha(tint, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={icon} size={16} color={active ? onPrimary : tint} />
            </View>
            {compact ? null : (
                <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
                    <Text numberOfLines={1} style={{ color: active ? primary : color || text, fontSize: 14, fontWeight: active ? '900' : '700' }}>{title}</Text>
                    {note ? <Text numberOfLines={1} style={{ color: muted, fontSize: 11.5, marginTop: 1 }}>{note}</Text> : null}
                </View>
            )}
        </Pressable>
    );
}
