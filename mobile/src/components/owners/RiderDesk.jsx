// Building blocks for the owner's rider pages on a computer (Riders, Performance, Live map, one rider). The phone never uses them: every page checks
// useOwnerDesktop() first, and Frame / TwoCol / Col draw nothing of their own when it is false.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';

export const Frame = ({ desk, max = 1240, children }) => (desk ? <View style={{ width: '100%', maxWidth: max, alignSelf: 'center' }}>{children}</View> : <>{children}</>);
export const TwoCol = ({ desk, children }) => (desk ? <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>{children}</View> : <>{children}</>);
export const Col = ({ desk, grow = 1, children }) => (desk ? <View style={{ flex: grow, minWidth: 0 }}>{children}</View> : <>{children}</>);

// the banner at the top of a page: the shop's gradient, a round icon, a title and a line under it, buttons on the right, and anything under them
export function Hero({ icon, lead, title, subtitle, right, children, style, compact }) {
    const { primary, primaryDark, onPrimary } = useBrand();
    return (
        <LinearGradient colors={[primary, primaryDark || primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ marginHorizontal: 16, marginTop: 8, marginBottom: compact ? 10 : 14, borderRadius: compact ? 22 : 28, overflow: 'hidden', padding: compact ? 16 : 26 }, style]}>
            <View pointerEvents="none" style={{ position: 'absolute', right: -50, top: -70, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', right: 240, bottom: -100, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                {lead || null}
                {!lead && icon ? <View style={{ width: compact ? 42 : 58, height: compact ? 42 : 58, borderRadius: compact ? 21 : 29, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: compact ? 12 : 16 }}><Ionicons name={icon} size={compact ? 21 : 29} color={onPrimary} /></View> : null}
                <View style={{ flex: 1, minWidth: 240 }}>
                    <Text style={{ color: onPrimary, fontSize: compact ? 21 : 28, fontWeight: '900', letterSpacing: -0.6 }} numberOfLines={1}>{title}</Text>
                    {subtitle ? <Text style={{ color: onPrimary, opacity: 0.85, fontSize: compact ? 13 : 14.5, marginTop: compact ? 1 : 3 }} numberOfLines={compact ? 1 : 2}>{subtitle}</Text> : null}
                </View>
                {right ? <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', rowGap: 8 }}>{right}</View> : null}
            </View>
            {children}
        </LinearGradient>
    );
}

// a pill button for the banner
export function HeroBtn({ label, icon, onPress, solid, compact }) {
    const { primary, onPrimary } = useBrand();
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: compact ? 13 : 16, height: compact ? 38 : 44, borderRadius: compact ? 19 : 22, marginLeft: 8, backgroundColor: solid ? (hovered ? '#F3F3F3' : '#FFFFFF') : (hovered ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)'), cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
            {icon ? <Ionicons name={icon} size={18} color={solid ? primary : onPrimary} /> : null}
            <Text style={{ color: solid ? primary : onPrimary, fontWeight: '800', fontSize: 14, marginLeft: icon ? 8 : 0 }}>{label}</Text>
        </Pressable>
    );
}

// a frosted number inside the banner
export function GlassStat({ label, value, icon, compact }) {
    const { onPrimary } = useBrand();
    return (
        <View style={{ flex: 1, minWidth: 0, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', marginRight: compact ? 10 : 12, paddingHorizontal: compact ? 12 : 16, height: compact ? 48 : 70, borderRadius: compact ? 14 : 18, backgroundColor: 'rgba(255,255,255,0.18)' }}>
            {icon ? <Ionicons name={icon} size={compact ? 19 : 24} color={onPrimary} style={{ marginRight: compact ? 9 : 12, opacity: 0.9 }} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: onPrimary, opacity: 0.85, fontSize: compact ? 11 : 12, fontWeight: '800' }} numberOfLines={1}>{label}</Text>
                <Text style={{ color: onPrimary, fontSize: String(value).length > 14 ? (compact ? 13 : 15) : String(value).length > 9 ? (compact ? 15 : 19) : (compact ? 18 : 24), fontWeight: '900', letterSpacing: -0.4 }} numberOfLines={1}>{value}</Text>
            </View>
        </View>
    );
}

// a number on a card with a coloured icon block (clickable when it has an onPress)
export function Tile({ label, value, icon, color, sub, onPress }) {
    const { surface, border, text, muted } = useBrand();
    return (
        <Pressable onPress={onPress} disabled={!onPress} style={({ hovered }) => ({ flex: 1, minWidth: 0, marginHorizontal: 8, borderRadius: 22, borderWidth: 1, borderColor: onPress && hovered ? color : border, backgroundColor: onPress && hovered ? alpha(color, 0.06) : surface, overflow: 'hidden', cursor: onPress ? 'pointer' : 'default', boxShadow: onPress && hovered ? `inset 0 0 0 1.5px ${color}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow, border-color', transitionDuration: '140ms' })}>
            <View pointerEvents="none" style={{ position: 'absolute', right: -24, top: -24, width: 100, height: 100, borderRadius: 50, backgroundColor: alpha(color, 0.1) }} />
            <View style={{ padding: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={21} color="#FFFFFF" /></View>
                    <Text style={{ flex: 1, color: muted, fontWeight: '800', fontSize: 13.5, marginLeft: 12 }} numberOfLines={1}>{label}</Text>
                </View>
                <Text style={{ color: text, fontWeight: '900', fontSize: String(value).length > 11 ? 22 : 32, letterSpacing: -0.8, marginTop: 12 }} numberOfLines={1}>{value}</Text>
                {sub ? <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>{sub}</Text> : <View style={{ height: 18 }} />}
            </View>
        </Pressable>
    );
}

// a status dot with a word: green online, amber idle, grey off
export function StatusDot({ color, label }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: alpha(color, 0.14) }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 6 }} />
            <Text style={{ color, fontSize: 12, fontWeight: '800' }}>{label}</Text>
        </View>
    );
}
