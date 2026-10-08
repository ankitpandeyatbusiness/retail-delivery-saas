// src/components/ui/cartParts.jsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, LayoutAnimation, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { tint } from './shop';

export const rs = (n) => `₹${+Number(n || 0).toFixed(2)}`;
export const ease = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

export function Press({ onPress, style, children, disabled, hitSlop, wrap }) {
    const v = useRef(new Animated.Value(1)).current;
    const to = (x) => Animated.spring(v, { toValue: x, friction: 6, tension: 220, useNativeDriver: true }).start();
    return (
        <Pressable onPress={onPress} disabled={disabled} hitSlop={hitSlop} style={wrap} onPressIn={() => to(0.96)} onPressOut={() => to(1)}>
            <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
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
        <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
            {children}
        </Animated.View>
    );
}

export function Chip({ label, on, onPress, icon }) {
    const { primary, text, surface, border } = useBrand();
    return (
        <Press onPress={() => { ease(); onPress(); }} style={[s.chip, { backgroundColor: on ? tint(primary) : surface, borderColor: on ? primary : border }]}>
            {icon ? <Ionicons name={icon} size={14} color={on ? primary : text} style={{ marginRight: 6 }} /> : null}
            <Text style={[s.chipTxt, { color: on ? primary : text }]}>{label}</Text>
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
    const { muted, border } = useBrand();
    const op = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        Animated.timing(op, { toValue: busy ? 0.5 : 1, duration: 200, useNativeDriver: true }).start();
    }, [busy]);
    const p = q.pricing;
    const isFreeDel = type === 'delivery' && p.deliveryFee === 0 && baseDeliveryFee > 0;
    return (
        <Animated.View style={{ opacity: op }}>
            <Row k="Item Total" v={rs(p.subtotal)} />
            {p.discount > 0 ? <Row k={`Coupon${p.couponCode ? ` (${p.couponCode})` : ''}`} v={`− ${rs(p.discount)}`} green /> : null}
            {type === 'delivery' ? <Row k="Delivery Partner Fee" v={isFreeDel ? 'FREE' : rs(p.deliveryFee)} strike={isFreeDel ? rs(baseDeliveryFee) : null} green={isFreeDel} /> : null}
            {p.packagingCharge > 0 ? <Row k="Restaurant Packaging" v={rs(p.packagingCharge)} /> : null}
            {p.taxMode === 'exclusive' && p.tax > 0 ? <Row k="Taxes & Charges" v={rs(p.tax)} /> : null}
            {p.tip > 0 ? <Row k="Delivery Tip" v={rs(p.tip)} /> : null}
            <View style={[s.line, { backgroundColor: border }]} />
            <Row k="Grand Total" v={rs(p.total)} bold />
            {p.taxMode === 'inclusive' && p.tax > 0 ? <Text style={[s.incl, { color: muted }]}>Includes {rs(p.tax)} taxes</Text> : null}
            {p.discount > 0 || isFreeDel ? (
                <Appear style={s.savings}>
                    <Text style={s.savingsTxt}>🎉 You saved {rs(p.discount + (isFreeDel ? baseDeliveryFee : 0))} on this order!</Text>
                </Appear>
            ) : null}
        </Animated.View>
    );
}

// Free delivery bar: the fill slides, the colour fades, the text cross-fades. Nothing jumps.
export function FreeDeliveryBar({ preview, freeAbove }) {
    const unlocked = preview >= freeAbove;
    const pct = Math.min(1, Math.max(0, preview / freeAbove));
    const w = useRef(new Animated.Value(pct)).current;
    const col = useRef(new Animated.Value(unlocked ? 1 : 0)).current;
    const fade = useRef(new Animated.Value(1)).current;
    const [shown, setShown] = useState(unlocked);

    useEffect(() => {
        Animated.timing(w, { toValue: pct, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, [pct]);

    useEffect(() => {
        Animated.timing(col, { toValue: unlocked ? 1 : 0, duration: 400, useNativeDriver: false }).start();
        if (shown === unlocked) return;
        Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
            setShown(unlocked);
            Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
        });
    }, [unlocked]);

    const bg = col.interpolate({ inputRange: [0, 1], outputRange: ['#FEF3F2', '#E6F4EA'] });
    const fg = col.interpolate({ inputRange: [0, 1], outputRange: ['#B3261E', '#1E8E3E'] });
    return (
        <Animated.View style={[s.tr, { backgroundColor: bg }]}>
            <Animated.View style={{ opacity: fade }}>
                <Animated.Text style={[s.trTxt, { color: fg }]}>
                    {shown ? 'Yay! You unlocked ' : `Add ${rs(Math.max(0, freeAbove - preview))} more to get `}
                    <Text style={{ fontWeight: '800' }}>FREE Delivery</Text> 🚲
                </Animated.Text>
            </Animated.View>
            <View style={s.trBg}>
                <Animated.View style={[s.trFill, { backgroundColor: fg, width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
            </View>
        </Animated.View>
    );
}

export function ClosedBanner({ message }) {
    const { error } = useBrand();
    return (
        <Appear style={[s.closed, { borderColor: error, backgroundColor: tint(error) }]}>
            <Ionicons name="time-outline" size={20} color={error} />
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[s.closedHead, { color: error }]}>Shop is closed</Text>
                <Text style={[s.closedTxt, { color: error }]}>{message}. You cannot place orders right now.</Text>
            </View>
        </Appear>
    );
}

// Pickup time windows from the server, grouped by day
export function PickupSlots({ res, picked, onPick }) {
    const { primary, text, muted, border, surface } = useBrand();
    if (!res) return <ActivityIndicator style={{ margin: 16 }} color={primary} />;
    if (!res.slots.length) {
        return (
            <View style={[s.noSlot, { borderColor: border, backgroundColor: surface }]}>
                <Ionicons name="time-outline" size={18} color={muted} />
                <Text style={[s.noSlotTxt, { color: muted }]}>{res.message || 'No pickup time available right now'}</Text>
            </View>
        );
    }
    const days = [...new Set(res.slots.map((x) => x.dayLabel))];
    return (
        <>
            {days.map((d) => (
                <View key={d}>
                    <Text style={[s.dayTxt, { color: muted }]}>{d.toUpperCase()}{res.slots.find((x) => x.dayLabel === d)?.dateLabel ? `  ·  ${res.slots.find((x) => x.dayLabel === d).dateLabel}` : ''}</Text>
                    <View style={s.slotWrap}>
                        {res.slots.filter((x) => x.dayLabel === d).map((x) => {
                            const on = picked === x.from;
                            return (
                                <Press key={x.from} onPress={() => onPick(x.from)} style={[s.slot, { backgroundColor: on ? tint(primary) : surface, borderColor: on ? primary : border }]}>
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
    trFill: { height: 4, borderRadius: 2 },
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