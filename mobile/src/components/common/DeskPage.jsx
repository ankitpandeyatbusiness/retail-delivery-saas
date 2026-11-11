// Building blocks for the DESKTOP website's pages (a browser at least 1024 px wide): a centred page, a header with a back button and a title, and a button
// with a hover. Only the desktop layouts use these; the phone screens never import them.
import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from './kit';
import { ActivityIndicator } from './Loading';
import { tr } from '../../i18n';

export const DESK_T = { transitionProperty: 'background-color, border-color, box-shadow, filter, opacity, transform', transitionDuration: '170ms' };

// the page: scrolls as a whole, content centred and no wider than `maxWidth`
export function DeskPage({ children, maxWidth = 1180, scroll = true }) {
    const { background } = useBrand();
    const inner = <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 26 }}>{children}</View>;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            {scroll ? <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 90 }}>{inner}</ScrollView> : inner}
        </View>
    );
}

// a round back arrow, the title, a line under it, and room on the right for buttons
export function DeskHeader({ title, subtitle, subtitleColor, right }) {
    const nav = useNavigation();
    const { text, muted, border } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Pressable
                onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('MainTabs'))}
                accessibilityRole="button"
                accessibilityLabel={tr('Back')}
                style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? border : 'transparent', cursor: 'pointer', ...DESK_T })}
            >
                <Ionicons name="arrow-back" size={24} color={text} />
            </Pressable>
            <View style={{ flex: 1, minWidth: 200 }}>
                <Text style={{ color: text, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 }}>{title}</Text>
                {subtitle ? <Text style={{ color: subtitleColor || muted, fontSize: 13.5, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
            {right}
        </View>
    );
}

// primary (filled, shop colour), ghost (outlined) or danger (outlined, red); brightens or tints under the mouse
export function DeskBtn({ label, icon, onPress, kind = 'primary', busy, disabled, grow, style }) {
    const { primary, radius, error } = useBrand();
    const color = kind === 'danger' ? error : primary;
    const filled = kind === 'primary';
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || busy}
            accessibilityRole="button"
            style={({ hovered }) => [{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, paddingHorizontal: 22, borderRadius: radius, flexGrow: grow ? 1 : 0,
                borderWidth: filled ? 0 : 1.5, borderColor: color, backgroundColor: filled ? primary : hovered ? `${color}1A` : 'transparent',
                filter: filled && hovered && !disabled ? 'brightness(1.12)' : 'brightness(1)', boxShadow: filled && hovered && !disabled ? `0 10px 26px ${primary}55` : '0 0 0 rgba(0,0,0,0)',
                opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer', ...DESK_T,
            }, style]}
        >
            {busy ? <ActivityIndicator color={filled ? '#FFFFFF' : color} /> : (
                <>
                    {icon ? <Ionicons name={icon} size={17} color={filled ? '#FFFFFF' : color} style={{ marginRight: 8 }} /> : null}
                    <Text numberOfLines={1} style={{ color: filled ? '#FFFFFF' : color, fontSize: 14.5, fontWeight: '900' }}>{label}</Text>
                </>
            )}
        </Pressable>
    );
}
