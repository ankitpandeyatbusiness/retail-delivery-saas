// src/components/ui/cartParts.jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, LayoutAnimation, Animated, Easing, Platform } from 'react-native';
import { ListShimmer } from '../owners/shimmer';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { tint } from './shop';
import { useIsDesktopWeb } from '../../utils/common/layout';
import { tr } from '../../i18n';

export const rs = (n) => `₹${+Number(n || 0).toFixed(2)}`;
export const ease = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

// hover: only on the desktop website, and only when asked for. true = a card lifts a little and gets a soft shadow while the mouse is on it;
// an object = just that look while the mouse is on it (a row that tints, say), no lift.
const HOVER_BASE = { cursor: 'pointer', transitionProperty: 'box-shadow, border-color', transitionDuration: '180ms' };
const HOVER_ON = { boxShadow: '0 14px 34px rgba(0,0,0,0.28)' };
export function Press({ onPress, style, children, disabled, hitSlop, wrap, hover }) {
    const v = useRef(new Animated.Value(1)).current;
    const desk = useIsDesktopWeb();
    const [hov, setHov] = useState(false);
    const live = !!hover && desk;
    const to = (x) => Animated.spring(v, { toValue: x, friction: 6, tension: 220, useNativeDriver: true }).start();
    return (
        <Pressable
            onPress={onPress} disabled={disabled} hitSlop={hitSlop} style={wrap} onPressIn={() => to(0.96)} onPressOut={() => to(1)}
            onHoverIn={live ? () => setHov(true) : undefined} onHoverOut={live ? () => setHov(false) : undefined}
        >
            <Animated.View style={[style, live && HOVER_BASE, live && hov && (typeof hover === 'object' ? hover : HOVER_ON), { transform: live && hov && hover === true ? [{ scale: v }, { translateY: -3 }] : [{ scale: v }] }]}>{children}</Animated.View>
        </Pressable>
    );
}

export function Appear({ children, delay = 0, style, skip }) {
    const v = useRef(new Animated.Value(skip ? 1 : 0)).current;
    useEffect(() => {
        if (skip) return;
        Animated.timing(v, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, []);
    return (
        <Animated.View needsOffscreenAlphaCompositing style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
            {children}
        </Animated.View>
    );
}

// a small picture for the common kitchen and delivery notes (the desktop chips show it when the shop gave none)
const CHIP_ICONS = [
    [/less spic|mild/i, 'leaf-outline'], [/spic|chill?i|hot sauce/i, 'flame-outline'], [/no onion|no garlic|jain/i, 'close-circle-outline'], [/extra|more/i, 'add-circle-outline'],
    [/crisp|crunch/i, 'sparkles-outline'], [/sweet|sugar/i, 'cafe-outline'], [/salt/i, 'water-outline'], [/oil|butter|ghee/i, 'water-outline'],
    [/no contact|contactless/i, 'hand-left-outline'], [/door|leave|gate|security|guard|reception/i, 'home-outline'], [/call|phone/i, 'call-outline'], [/ring|bell|knock/i, 'notifications-outline'],
    [/cutlery|spoon|fork|plate/i, 'restaurant-outline'], [/pack|bag|parcel/i, 'bag-handle-outline'], [/warm|hot\b/i, 'thermometer-outline'], [/ice|cold|chill/i, 'snow-outline'],
];
const chipIcon = (label) => { const l = String(label || ''); const hit = CHIP_ICONS.find(([re]) => re.test(l)); return hit ? hit[1] : null; };

export function Chip({ label, on, onPress, icon }) {
    const { primary, onPrimary, text, surface, border } = useBrand();
    const desk = useIsDesktopWeb();
    if (desk) {
        // the desktop website: a bigger chip. Chosen = filled with the shop's colour, a tick and a glow; under the mouse = a tinted fill, a ring and a small grow.
        const ic = icon || chipIcon(label);
        return (
            <Pressable
                onPress={() => { ease(); onPress(); }}
                accessibilityRole="button"
                accessibilityState={{ selected: !!on }}
                style={({ hovered }) => ({
                    flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 20, borderRadius: 23, marginRight: 10, marginBottom: 10, borderWidth: 1.5,
                    borderColor: on || hovered ? primary : border,
                    backgroundColor: on ? primary : hovered ? tint(primary) : surface,
                    boxShadow: on ? `0 8px 20px ${primary}45` : hovered ? `inset 0 0 0 1px ${primary}55, 0 4px 14px ${primary}22` : '0 0 0 rgba(0,0,0,0)',
                    transform: [{ scale: hovered && !on ? 1.05 : 1 }], cursor: 'pointer',
                    transitionProperty: 'background-color, border-color, box-shadow, transform', transitionDuration: '180ms',
                })}
            >
                {ic ? <Ionicons name={ic} size={17} color={on ? onPrimary : primary} style={{ marginRight: 8 }} /> : null}
                <Text numberOfLines={1} style={{ color: on ? onPrimary : text, fontSize: 14.5, fontWeight: '800' }}>{label}</Text>
                {on ? <Ionicons name="checkmark-circle" size={17} color={onPrimary} style={{ marginLeft: 8 }} /> : null}
            </Pressable>
        );
    }
    return (
        <Press onPress={() => { ease(); onPress(); }} style={[s.chip, { backgroundColor: on ? tint(primary) : surface, borderColor: on ? primary : border }]}>
            {icon ? <Ionicons name={icon} size={14} color={on ? primary : text} style={{ marginRight: 6 }} /> : null}
            <Text numberOfLines={1} style={[s.chipTxt, { color: on ? primary : text }]}>{label}</Text>
        </Press>
    );
}

function Row({ k, v, green, bold, strike }) {
    const { text, muted } = useBrand();
    return (
        <View style={s.bRow}>
            <Text style={[s.bK, bold && s.bold, { color: green ? '#1E8E3E' : text }]}>{k}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {strike ? <Text style={[s.strike, { color: muted }]}>{strike}</Text> : null}
                <Text style={[s.bV, bold && s.bold, { color: green ? '#1E8E3E' : text }]}>{v}</Text>
            </View>
        </View>
    );
}

export function Bill({ q, type, busy, baseDeliveryFee }) {
    const { muted, border, ok, okSoft } = useBrand();
    const op = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        Animated.timing(op, { toValue: busy ? 0.5 : 1, duration: 200, useNativeDriver: true }).start();
    }, [busy]);
    const p = q.pricing;
    const isFreeDel = type === 'delivery' && p.deliveryFee === 0 && baseDeliveryFee > 0;
    return (
        <Animated.View style={{ opacity: op }}>
            <Row k={tr('Item Total')} v={rs(p.subtotal)} />
            {p.offerDiscount > 0 ? <Row k={tr(p.offerLabel)} v={`− ${rs(p.offerDiscount)}`} green /> : null}
            {p.discount - (p.offerDiscount || 0) > 0 ? <Row k={tr('Coupon{v1}', { v1: p.couponCode ? ` (${p.couponCode})` : '' })} v={`− ${rs(p.discount - (p.offerDiscount || 0))}`} green /> : null}
            {type === 'delivery' ? <Row k={tr('Delivery Partner Fee')} v={isFreeDel ? 'FREE' : rs(p.deliveryFee)} strike={isFreeDel ? rs(baseDeliveryFee) : null} green={isFreeDel} /> : null}
            {p.packagingCharge > 0 ? <Row k={tr('Restaurant Packaging')} v={rs(p.packagingCharge)} /> : null}
            {(p.taxOnTop ?? (p.taxMode === 'exclusive' ? p.tax : 0)) > 0 ? <Row k={tr('Taxes & Charges')} v={rs(p.taxOnTop ?? p.tax)} /> : null}
            {p.tip > 0 ? <Row k={tr('Delivery Tip')} v={rs(p.tip)} /> : null}
            <View style={[s.line, { backgroundColor: border }]} />
            <Row k={tr('Grand Total')} v={rs(p.total)} bold />
            {(p.taxIncluded ?? (p.taxMode === 'inclusive' ? p.tax : 0)) > 0 ? <Text style={[s.incl, { color: muted }]}>{tr('Includes {rs} taxes', { rs: rs(p.taxIncluded ?? p.tax) })}</Text> : null}
            {p.discount > 0 || isFreeDel ? (
                <Appear style={[s.savings, { backgroundColor: okSoft }]}>
                    <Text style={[s.savingsTxt, { color: ok }]}>{tr('🎉 You saved {rs} on this order!', { rs: rs(p.discount + (isFreeDel ? baseDeliveryFee : 0)) })}</Text>
                </Appear>
            ) : null}
        </Animated.View>
    );
}

// Free delivery bar: the fill slides, the colour fades, the text cross-fades. Nothing jumps.
export function FreeDeliveryBar({ preview, freeAbove }) {
    const { errorText, errorSoft, ok, okSoft } = useBrand();
    const desk = Platform.OS === 'web';   // the website (desktop and phone-sized browsers): a rounded card of its own, with room above and below (false in the phone app)
    const unlocked = preview >= freeAbove;
    const pct = Math.min(1, Math.max(0, preview / freeAbove));

    // Everything that moves is on the native driver (scale and opacity only), so a busy JS thread
    // (the cart re-pricing, the list re-laying out) can no longer make the bar stutter.
    const w = useRef(new Animated.Value(pct)).current;         // how full the bar is, 0..1 (drawn as scaleX)
    const col = useRef(new Animated.Value(unlocked ? 1 : 0)).current;   // 0 = still earning, 1 = unlocked
    const fade = useRef(new Animated.Value(1)).current;
    const [shown, setShown] = useState(unlocked);

    useEffect(() => {
        Animated.timing(w, { toValue: pct, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [pct]);

    useEffect(() => {
        Animated.timing(col, { toValue: unlocked ? 1 : 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        if (shown === unlocked) return;
        Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
            setShown(unlocked);
            Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
        });
    }, [unlocked]);

    const fg = shown ? ok : errorText;
    return (
        <View style={[s.tr, { backgroundColor: errorSoft, overflow: 'hidden' }, desk && { marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderRadius: 16 }]}>
            {/* the "unlocked" background fades in over the "keep going" one (no colour animation on the JS thread) */}
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: okSoft, opacity: col }]} />
            <Animated.View style={{ opacity: fade }}>
                <Text style={[s.trTxt, { color: fg }]}>
                    {shown ? tr('Yay! You unlocked ') : tr('Add {rs} more to get ', { rs: rs(Math.max(0, freeAbove - preview)) })}
                    <Text style={{ fontWeight: '800' }}>{tr('FREE Delivery')}</Text> 🚲
                </Text>
            </Animated.View>
            <View style={s.trBg}>
                {/* two fills of the same size; the bar is shown by scaling them from the left edge */}
                <Animated.View style={[s.trFill, { backgroundColor: errorText, transform: [{ scaleX: w }], transformOrigin: 'left' }]} />
                <Animated.View style={[s.trFill, StyleSheet.absoluteFill, { backgroundColor: ok, opacity: col, transform: [{ scaleX: w }], transformOrigin: 'left' }]} />
            </View>
        </View>
    );
}

export function ClosedBanner({ message }) {
    const { error } = useBrand();
    return (
        <Appear style={[s.closed, { borderColor: error, backgroundColor: tint(error) }]}>
            <Ionicons name="time-outline" size={20} color={error} />
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[s.closedHead, { color: error }]}>{tr('Shop is closed')}</Text>
                <Text style={[s.closedTxt, { color: error }]}>{tr('{message}. You cannot place orders right now.', { message: message })}</Text>
            </View>
        </Appear>
    );
}

// Pickup time windows from the server, grouped by day
export function PickupSlots({ res, picked, onPick }) {
    const { primary, text, muted, border, surface } = useBrand();
    const desk = useIsDesktopWeb();   // the desktop website: roomier time buttons that light up under the mouse, with a heading per day (false in the phone app)
    if (!res) return <ListShimmer count={2} />;
    if (!res.slots.length) {
        return (
            <View style={[s.noSlot, { borderColor: border, backgroundColor: surface }, desk && { padding: 18, borderRadius: 18 }]}>
                <Ionicons name="time-outline" size={18} color={muted} />
                <Text style={[s.noSlotTxt, { color: muted }]}>{res.message || tr('No pickup time available right now')}</Text>
            </View>
        );
    }
    const days = [...new Set(res.slots.map((x) => x.dayLabel))];
    return (
        <>
            {days.map((d) => (
                <View key={d}>
                    <Text style={[s.dayTxt, { color: muted }, desk && { color: text, fontSize: 13, fontWeight: '900', letterSpacing: 1, marginTop: 6, marginBottom: 10 }]}>{d.toUpperCase()}{res.slots.find((x) => x.dayLabel === d)?.dateLabel ? `  ·  ${res.slots.find((x) => x.dayLabel === d).dateLabel}` : ''}</Text>
                    <View style={s.slotWrap}>
                        {res.slots.filter((x) => x.dayLabel === d).map((x) => {
                            const on = picked === x.from;
                            return (
                                <Press key={x.from} onPress={() => onPick(x.from)} hover={on ? undefined : { backgroundColor: tint(primary), borderColor: primary }} style={[s.slot, { backgroundColor: on ? tint(primary) : surface, borderColor: on ? primary : border }, desk && { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16, minWidth: 128, marginRight: 10, marginBottom: 10 }]}>
                                    <Ionicons name={on ? 'checkmark-circle' : 'time-outline'} size={16} color={on ? primary : muted} style={{ marginRight: 6 }} />
                                    <Text style={[s.slotTxt, { color: on ? primary : text }]}>{x.label}</Text>
                                </Press>
                            );
                        })}
                    </View>
                </View>
            ))}
        </>
    );
}

const s = StyleSheet.create({
    tr: { paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', minHeight: 54 },
    trTxt: { fontSize: 13, fontWeight: '500', textAlign: 'center' },
    trBg: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)', marginTop: 8, overflow: 'hidden' },
    trFill: { height: 4, width: '100%', borderRadius: 2 },
    chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderRadius: 20, marginRight: 8, marginBottom: 8 },
    chipTxt: { fontSize: 13, fontWeight: '700' },
    bRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    bK: { fontSize: 13, fontWeight: '500' },
    bV: { fontSize: 13, fontWeight: '600' },
    strike: { fontSize: 12, textDecorationLine: 'line-through', marginRight: 6 },
    bold: { fontSize: 15, fontWeight: '900' },
    line: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
    incl: { fontSize: 11, marginTop: 4 },
    savings: { backgroundColor: '#E6F4EA', padding: 10, borderRadius: 8, marginTop: 12, alignItems: 'center' },
    savingsTxt: { color: '#1E8E3E', fontSize: 12, fontWeight: '700' },
    closed: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 0, padding: 14, borderWidth: 1, borderRadius: 14 },
    closedHead: { fontSize: 14, fontWeight: '900' },
    closedTxt: { fontSize: 12, marginTop: 2, lineHeight: 17 },
    noSlot: { flexDirection: 'row', alignItems: 'center', padding: 14, borderWidth: 1, borderRadius: 12 },
    noSlotTxt: { marginLeft: 10, fontSize: 13, fontWeight: '600', flex: 1 },
    dayTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
    slotWrap: { flexDirection: 'row', flexWrap: 'wrap' },
    slot: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1.5, borderRadius: 12, marginRight: 8, marginBottom: 8 },
    slotTxt: { fontSize: 13, fontWeight: '800' },
});