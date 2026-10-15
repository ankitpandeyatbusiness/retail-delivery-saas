// src/components/customers/coupon.jsx
//
// One coupon ticket for the whole app (home strip, Offers page, cart):
//   a brand-gradient stub with the value ("20%" / "₹100"), a notched edge, and the code with what it gives.
//   size: 'strip' (home, fixed width) | 'full' (Offers page, full width) | 'mini' (cart, tap to apply)
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, CardGlow } from '../common/kit';
import { CopyIcon } from '../common/copyCode';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function offerText(o) {
    if (o.description) return o.description;
    if (o.discountType === 'percent') return `${o.discountValue}% off${o.maxDiscount ? ` up to ₹${o.maxDiscount}` : ''}`;
    return `₹${o.discountValue} off`;
}

export function offerMeta(o) {
    const end = o.endsAt ? new Date(o.endsAt) : null;
    return [
        o.minOrder ? `Min order ₹${o.minOrder}` : '',
        o.firstOrderOnly ? 'First order only' : '',
        end ? `Ends ${end.getDate()} ${MONTHS[end.getMonth()]}` : '',
    ].filter(Boolean).join(' · ');
}

export function CouponTicket({ o, size = 'strip', onPress, hint, style }) {
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, surface, border, background } = useBrand();
    const percent = o.discountType === 'percent';
    const value = percent ? `${o.discountValue}%` : `₹${o.discountValue}`;
    const mini = size === 'mini';
    const stubW = mini ? 56 : 88;
    const height = mini ? 60 : size === 'full' ? 108 : 100;
    const width = mini ? 172 : size === 'strip' ? 292 : undefined;
    const meta = offerMeta(o);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                s.ticket,
                { height, width, backgroundColor: surface, borderColor: border, opacity: pressed ? 0.9 : 1 },
                style,
            ]}
        >
            <CardGlow radius={18} />
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.stub, { width: stubW }]}>
                <Text style={[mini ? s.valMini : s.val, { color: onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                <Text style={[s.off, { color: onPrimary }]}>OFF</Text>
            </LinearGradient>
            {/* the notches that make it a ticket: the page colour cut out of the edge */}
            <View style={[s.notch, { top: -8, left: stubW - 8, backgroundColor: background }]} />
            <View style={[s.notch, { bottom: -8, left: stubW - 8, backgroundColor: background }]} />

            <View style={s.body}>
                <View style={s.codeRow}>
                    <View style={[s.codeBox, { borderColor: primary, backgroundColor: `${primary}14` }]}>
                        <Text style={[s.code, { color: primary }]} numberOfLines={1}>{o.code}</Text>
                    </View>
                    {mini ? null : <CopyIcon code={o.code} color={primary} size={17} style={{ marginLeft: 10 }} />}
                </View>
                {mini ? (
                    <Text style={[s.hint, { color: muted }]} numberOfLines={1}>{hint || 'Tap to apply'}</Text>
                ) : (
                    <>
                        <Text style={[s.desc, { color: text }]} numberOfLines={2}>{offerText(o)}</Text>
                        {meta ? <Text style={[s.meta, { color: muted }]} numberOfLines={1}>{meta}</Text> : null}
                    </>
                )}
            </View>
            {mini ? null : <Ionicons name="chevron-forward" size={16} color={muted} style={s.chev} />}
        </Pressable>
    );
}

const s = StyleSheet.create({
    ticket: { flexDirection: 'row', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, elevation: 2, shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
    stub: { alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: 18, borderBottomLeftRadius: 18, paddingHorizontal: 6 },
    val: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
    valMini: { fontSize: 17, fontWeight: '900' },
    off: { fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 1, opacity: 0.92 },
    notch: { position: 'absolute', width: 16, height: 16, borderRadius: 8 },
    body: { flex: 1, paddingLeft: 16, paddingRight: 12, justifyContent: 'center' },
    codeRow: { flexDirection: 'row', alignItems: 'center' },
    codeBox: { alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
    code: { fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
    desc: { fontSize: 13, fontWeight: '700', marginTop: 8, lineHeight: 17 },
    meta: { fontSize: 11, marginTop: 3 },
    hint: { fontSize: 10.5, fontWeight: '600', marginTop: 5 },
    chev: { alignSelf: 'center', marginRight: 10 },
});
