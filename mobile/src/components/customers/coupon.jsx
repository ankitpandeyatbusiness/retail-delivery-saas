// src/components/customers/coupon.jsx
//
// One coupon ticket for the whole app (home strip, Offers page, cart):
//   a brand-gradient stub with the value ("20%" / "₹100"), a notched edge, and the code with what it gives.
//   size: 'strip' (home, fixed width) | 'full' (Offers page, full width) | 'mini' (cart, tap to apply)
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, CardGlow } from '../common/kit';
import { CopyIcon } from '../common/copyCode';
import { tr } from '../../i18n';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function offerText(o) {
    if (o.description) return tr(o.description);
    if (o.discountType === 'percent') return o.maxDiscount ? tr('{n}% off up to ₹{max}', { n: o.discountValue, max: o.maxDiscount }) : tr('{n}% off', { n: o.discountValue });
    return tr('₹{n} off', { n: o.discountValue });
}

export function offerMeta(o) {
    const end = o.endsAt ? new Date(o.endsAt) : null;
    return [
        o.minOrder ? tr('Min order ₹{n}', { n: o.minOrder }) : '',
        o.firstOrderOnly ? tr('First order only') : '',
        o.dineInOnly ? tr('Dine in only') : '',
        end ? tr('Ends {d} {m}', { d: end.getDate(), m: tr(MONTHS[end.getMonth()]) }) : '',
    ].filter(Boolean).join(' · ');
}

// The small ticket on the WEBSITE (the cart's "tap to apply" row, which scrolls sideways and clips anything outside its own box). Every effect is drawn INSIDE the
// ticket, so nothing is ever cut off. Look: a gradient body, a bright stub, a dashed code box. On hover: a glowing red ring inside the edge, a soft shine that
// sweeps across, the code box fills with the shop's colour, and "Tap to apply" becomes "Apply now" with a sliding arrow. Every ticket is the same size.
function MiniTicketWeb({ o, onPress, hint, style }) {
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, surface, border, background } = useBrand();
    const value = o.discountType === 'percent' ? `${o.discountValue}%` : `₹${o.discountValue}`;
    const stubW = 68;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            style={({ hovered, pressed }) => [{
                width: 250, height: 70, flexDirection: 'row', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: hovered ? primary : border,
                backgroundColor: surface, backgroundImage: `linear-gradient(120deg, ${surface} 0%, ${primary}22 100%)`,
                boxShadow: hovered ? `inset 0 0 0 1px ${primary}, inset 0 0 30px ${primary}38` : 'inset 0 0 0 0 transparent',
                cursor: 'pointer', opacity: pressed ? 0.92 : 1, transitionProperty: 'border-color, box-shadow, opacity', transitionDuration: '240ms',
            }, style]}
        >
            {({ hovered }) => (
                <>
                    <LinearGradient
                        colors={[primaryLight, primaryDark]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={{ width: stubW, alignItems: 'center', justifyContent: 'center', filter: hovered ? 'brightness(1.14)' : 'brightness(1)', transitionProperty: 'filter', transitionDuration: '240ms' }}
                    >
                        <Text style={{ color: onPrimary, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 }} numberOfLines={1}>{value}</Text>
                        <Text style={{ color: onPrimary, fontSize: 11, fontWeight: '800', letterSpacing: 2, opacity: 0.92, marginTop: 1 }}>{tr('OFF')}</Text>
                    </LinearGradient>
                    {/* the notches that make it a ticket */}
                    <View pointerEvents="none" style={{ position: 'absolute', top: -8, left: stubW - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: background }} />
                    <View pointerEvents="none" style={{ position: 'absolute', bottom: -8, left: stubW - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: background }} />
                    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 18, paddingRight: 12 }}>
                        <View
                            style={{
                                alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: primary, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 3,
                                backgroundColor: hovered ? primary : `${primary}1A`, transitionProperty: 'background-color', transitionDuration: '240ms',
                            }}
                        >
                            <Text style={{ color: hovered ? onPrimary : primary, fontSize: 14, fontWeight: '900', letterSpacing: 1.3, transitionProperty: 'color', transitionDuration: '240ms' }} numberOfLines={1}>{o.code}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7 }}>
                            <Ionicons name="flash" size={12} color={hovered ? primary : muted} />
                            <Text style={{ color: hovered ? primary : muted, fontSize: 11.5, fontWeight: hovered ? '900' : '700', marginLeft: 4 }} numberOfLines={1}>{hovered && !hint ? tr('Apply now') : (hint || tr('Tap to apply'))}</Text>
                            <Ionicons name="arrow-forward" size={12} color={primary} style={{ marginLeft: 4, opacity: hovered ? 1 : 0, transform: [{ translateX: hovered ? 3 : -6 }], transitionProperty: 'opacity, transform', transitionDuration: '240ms' }} />
                        </View>
                    </View>
                    {/* the shine: a soft diagonal band that crosses the ticket once each time the mouse comes onto it */}
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute', top: -12, bottom: -12, left: 0, width: 56, backgroundImage: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.2), transparent)',
                            transform: [{ translateX: hovered ? 300 : -90 }, { skewX: '-18deg' }], transitionProperty: 'transform', transitionDuration: hovered ? '750ms' : '0ms', transitionTimingFunction: 'ease-out',
                        }}
                    />
                </>
            )}
        </Pressable>
    );
}

// The big ticket of the DESKTOP home page's "Offers for you" (size 'desk', asked for only by HomeDesktop). A bold gradient stub with the value, a dashed tear line
// with two notches, then the code (with copy), what the offer gives, its small print and a "View offer" link. On hover the ticket lifts with a coloured glow, a
// soft shine crosses it, the code box fills with the shop's colour and the arrow slides.
function DeskTicketWeb({ o, onPress, style }) {
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, surface, border, background } = useBrand();
    const value = o.discountType === 'percent' ? `${o.discountValue}%` : `₹${o.discountValue}`;
    const stubW = 124;
    const meta = offerMeta(o);
    const T = { transitionProperty: 'background-color, color, opacity, transform, box-shadow, border-color', transitionDuration: '240ms' };
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            style={({ hovered, pressed }) => [{
                height: 136, flexDirection: 'row', borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: surface,
                backgroundImage: `linear-gradient(120deg, ${surface} 0%, ${primary}1C 100%)`, cursor: 'pointer', opacity: pressed ? 0.94 : 1,
                boxShadow: hovered ? `0 16px 36px ${primary}30, inset 0 0 0 1px ${primary}` : '0 2px 10px rgba(0,0,0,0.06)', ...T,
            }, style]}
        >
            {({ hovered }) => (
                <>
                    <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: stubW, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <Ionicons name="pricetag" size={84} color={onPrimary} style={{ position: 'absolute', right: -16, bottom: -14, opacity: 0.13, transform: [{ rotate: '-18deg' }] }} />
                        <Text numberOfLines={1} style={{ color: onPrimary, fontSize: 36, fontWeight: '900', letterSpacing: -1 }}>{value}</Text>
                        <Text style={{ color: onPrimary, fontSize: 12, fontWeight: '900', letterSpacing: 3, opacity: 0.92, marginTop: 1 }}>{tr('OFF')}</Text>
                    </LinearGradient>
                    {/* the tear line and the two notches that make it a ticket */}
                    <View pointerEvents="none" style={{ position: 'absolute', top: 16, bottom: 16, left: stubW, width: 0, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: `${primary}55` }} />
                    <View pointerEvents="none" style={{ position: 'absolute', top: -10, left: stubW - 10, width: 20, height: 20, borderRadius: 10, backgroundColor: background }} />
                    <View pointerEvents="none" style={{ position: 'absolute', bottom: -10, left: stubW - 10, width: 20, height: 20, borderRadius: 10, backgroundColor: background }} />
                    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center', paddingLeft: 24, paddingRight: 18 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: hovered ? primary : `${primary}1A`, ...T }}>
                                <Text numberOfLines={1} style={{ color: hovered ? onPrimary : primary, fontSize: 15, fontWeight: '900', letterSpacing: 1.5, ...T }}>{o.code}</Text>
                            </View>
                            <CopyIcon code={o.code} color={primary} size={18} style={{ marginLeft: 10 }} />
                        </View>
                        <Text numberOfLines={2} style={{ color: text, fontSize: 14.5, fontWeight: '800', lineHeight: 19, marginTop: 10 }}>{offerText(o)}</Text>
                        {meta ? <Text numberOfLines={1} style={{ color: muted, fontSize: 12, marginTop: 3 }}>{meta}</Text> : null}
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <Text style={{ color: primary, fontSize: 13, fontWeight: '900' }}>{tr('View offer')}</Text>
                            <Ionicons name="arrow-forward" size={14} color={primary} style={{ marginLeft: 5, transform: [{ translateX: hovered ? 5 : 0 }], ...T }} />
                        </View>
                    </View>
                    {/* the shine: a soft diagonal band that crosses the ticket once each time the mouse comes onto it */}
                    <View
                        pointerEvents="none"
                        style={{
                            position: 'absolute', top: -14, bottom: -14, left: 0, width: 70, backgroundImage: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.22), transparent)',
                            transform: [{ translateX: hovered ? 620 : -120 }, { skewX: '-18deg' }], transitionProperty: 'transform', transitionDuration: hovered ? '900ms' : '0ms', transitionTimingFunction: 'ease-out',
                        }}
                    />
                </>
            )}
        </Pressable>
    );
}

export function CouponTicket({ o, size = 'strip', onPress, hint, style }) {
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, surface, border, background } = useBrand();
    if (size === 'mini' && Platform.OS === 'web') return <MiniTicketWeb o={o} onPress={onPress} hint={hint} style={style} />;
    if (size === 'desk' && Platform.OS === 'web') return <DeskTicketWeb o={o} onPress={onPress} style={style} />;
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
            style={({ pressed, hovered }) => [
                s.ticket,
                { height, width, backgroundColor: surface, borderColor: border, opacity: pressed ? 0.9 : 1 },
                // the website: a hand cursor, and the ticket lifts a little with a coloured edge while the mouse is on it
                Platform.OS === 'web' && { cursor: 'pointer', transitionProperty: 'border-color, box-shadow, transform', transitionDuration: '180ms' },
                Platform.OS === 'web' && hovered && { borderColor: primary, boxShadow: `0 10px 28px ${primary}2E` },
                style,
            ]}
        >
            <CardGlow radius={18} />
            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.stub, { width: stubW }]}>
                <Text style={[mini ? s.valMini : s.val, { color: onPrimary }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
                <Text style={[s.off, { color: onPrimary }]}>{tr('OFF')}</Text>
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
                    <Text style={[s.hint, { color: muted }]} numberOfLines={1}>{hint || tr('Tap to apply')}</Text>
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
