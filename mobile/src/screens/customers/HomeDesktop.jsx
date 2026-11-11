// The Home page of the DESKTOP website (a browser at least 1024 px wide). The phone, the phone browser and tablets keep HomeScreen exactly as it is:
// HomeScreen picks this one only on a wide web window (utils/common/layout.js useCustomerDesktop).
//
//   [ shop name, tagline, info pills ]   [ the shop's banner, with dots ]
//   [ VISIT US  address ........................................ (->) ]
//   [ category ][ category ][ category ][ category ]      (4 across, wider than tall)
//   offers, bestsellers, combos, then the dishes, section by section
// The Delivery | Pickup | Dine in switch, the search, the address and the cart live in the top bar (DesktopTopBar).
//
// It is built from what the shop has switched on, and every part closes up when it is off or empty:
//   - no banner (or the banner block is off): the title takes the full width; one banner: no dots
//   - "Visit us" only when the shop has an address and Directions is on
//   - the info pills (open now, minutes, delivery fee, minimum order) follow the shop's switches
//   - the categories fill from the left, so 2 categories or 20 both look right; offers, bestsellers, combos... appear only when they have something to show
//   - the dish sections follow the shop's grouping setting
// Colours come from the shop's own theme (useBrand), so a dark shop looks dark and every shop wears its own colour.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, onColor } from '../../components/common/kit';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useMenuStore, useCartStore, useFavStore } from '../../store/customers/shopStores';
import { useFilterStore, applyFilters } from '../../store/customers/useFilterStore';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { useOrderMode, modesOf } from '../../store/customers/useOrderMode';
import { useStoreSpot, openDirections } from '../../components/customers/storeLocation';
import { ItemCard, useClosedStyle, closedText, tint } from '../../components/customers/shop';
import { CouponTicket } from '../../components/customers/coupon';
import { FiltersRow } from '../../components/customers/finder';
import { SkelFeed } from '../../components/customers/skeletons';
import BranchChip from '../../components/customers/BranchChip';
import BulkCartBar from '../../components/customers/BulkCartBar';
import DineBusyNote from '../../components/customers/DineBusyNote';
import DineHomeCard from '../../components/customers/DineHomeCard';
import FilterDialog from './FilterDialog';
import { DESKTOP_PAGE_MAX } from '../../utils/common/layout';
import { tr } from '../../i18n';

const GAP = 16;
const CARD_MIN = 215;   // a dish card is about as wide as on a phone: more columns, never huge cards

/* one row of equal cells per `cols` items; a short last row keeps the cell width (no stretched card) */
function Grid({ items, cols, render, gap = GAP }) {
    const c = Math.max(1, cols);
    const rows = [];
    for (let i = 0; i < items.length; i += c) rows.push(items.slice(i, i + c));
    return (
        <View style={{ gap }}>
            {rows.map((r, ri) => (
                <View key={ri} style={{ flexDirection: 'row', gap }}>
                    {Array.from({ length: c }).map((_, i) => <View key={i} style={{ flex: 1 }}>{r[i] ? render(r[i]) : null}</View>)}
                </View>
            ))}
        </View>
    );
}

// A section's heading: a round tinted icon (when the section has one), the title and a line under it, and a "See all" pill on the right that fills with the
// shop's colour under the mouse while its arrow slides.
function SecHead({ title, sub, onSee, icon }) {
    const { primary, onPrimary, text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            {icon ? (
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tint(primary), alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                    <Ionicons name={icon} size={22} color={primary} />
                </View>
            ) : <View style={{ width: 4, height: sub ? 32 : 22, borderRadius: 2, backgroundColor: primary, marginRight: 12 }} />}
            <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: text, fontSize: 21, fontWeight: '900', letterSpacing: -0.3 }}>{title}</Text>
                {sub ? <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{sub}</Text> : null}
            </View>
            {onSee ? (
                <Pressable
                    onPress={onSee}
                    accessibilityRole="button"
                    style={({ hovered }) => ({
                        flexDirection: 'row', alignItems: 'center', height: 36, paddingLeft: 16, paddingRight: 10, borderRadius: 18, borderWidth: 1.5, borderColor: primary,
                        backgroundColor: hovered ? primary : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '170ms',
                    })}
                >
                    {({ hovered }) => (
                        <>
                            <Text style={{ color: hovered ? onPrimary : primary, fontWeight: '800', fontSize: 14, transitionProperty: 'color', transitionDuration: '170ms' }}>{tr('See all')}</Text>
                            <Ionicons name="chevron-forward" size={16} color={hovered ? onPrimary : primary} style={{ marginLeft: 2, transform: [{ translateX: hovered ? 3 : 0 }], transitionProperty: 'transform', transitionDuration: '170ms' }} />
                        </>
                    )}
                </Pressable>
            ) : null}
        </View>
    );
}

/* ---------------- the shop, and its banner beside it ---------------- */
function Pill({ icon, dot, text }) {
    const { surface, border, text: fg } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: surface, borderWidth: 1, borderColor: border, marginRight: 8, marginBottom: 8 }}>
            {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot, marginRight: 7 }} /> : null}
            {icon ? <Ionicons name={icon} size={14} color={fg} style={{ marginRight: 6 }} /> : null}
            <Text style={{ color: fg, fontSize: 12.5, fontWeight: '700' }}>{text}</Text>
        </View>
    );
}

function Header({ mode, hero }) {
    const { text, muted } = useBrand();
    const theme = useThemeStore((s) => s.theme);
    const full = useHomeStore((s) => s.full);
    const compact = theme.headerStyle === 'compact';
    const open = full.restaurant.isOpen;
    const mins = full.orders.prepTimeMin;
    const fee = full.orders.deliveryFee || {};
    const delivers = (full.orders.types || []).includes('delivery');

    const pills = [];
    if (full.features.prepTime && mins) pills.push({ icon: 'time-outline', text: tr('{n} min', { n: mins }) });
    if (delivers && mode === 'delivery') {
        if (fee.type === 'free' || !fee.amount) pills.push({ icon: 'bicycle-outline', text: tr('Free delivery') });
        else if (fee.freeAbove > 0) pills.push({ icon: 'bicycle-outline', text: tr('Free above ₹{n}', { n: fee.freeAbove }) });
        else pills.push({ icon: 'bicycle-outline', text: tr('₹{n} delivery', { n: fee.amount }) });
    }
    if (full.orders.minOrder > 0) pills.push({ icon: 'bag-check-outline', text: tr('Min ₹{n}', { n: full.orders.minOrder }) });

    const n = String(theme.name || '').length;
    const size = compact ? 26 : n <= 22 ? 40 : n <= 36 ? 36 : 30;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 22, paddingBottom: 18 }}>
            <View style={{ flex: hero ? 4 : 1, paddingRight: hero ? 32 : 0 }}>
                <Text style={{ color: text, fontSize: size, lineHeight: Math.round(size * 1.16), fontWeight: '900', letterSpacing: -0.5 }}>{theme.name}</Text>
                {theme.tagline && !compact ? <Text style={{ color: muted, fontSize: 15, lineHeight: 22, marginTop: 8 }}>{tr(theme.tagline)}</Text> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 }}>
                    <Pill dot={open ? '#4ADE80' : '#FF6B6B'} text={open ? tr('Open now') : tr('Closed')} />
                    {pills.map((p) => <Pill key={p.text} icon={p.icon} text={p.text} />)}
                </View>
            </View>
            {hero ? <View style={{ flex: 6 }}>{hero}</View> : null}
        </View>
    );
}

function Hero({ list, onOrder }) {
    const { primary, primaryLight, primaryDark, border } = useBrand();
    const n = list.length;
    const [cur, setCur] = useState(0);
    useEffect(() => { if (cur >= n) setCur(0); }, [n, cur]);   // a banner was removed while it was showing
    useEffect(() => {   // auto-advance; restarts after every change so a click is never undone at once
        if (n < 2) return undefined;
        const t = setInterval(() => setCur((i) => (i + 1) % n), 5500);
        return () => clearInterval(t);
    }, [n, cur]);

    // A sideways two-finger swipe on the trackpad changes the slide (left = next, right = previous). One swipe moves ONE slide: the trackpad keeps
    // sending movement after the fingers lift, so the banner waits a moment before it listens again. Over the banner the browser's own "swipe to go
    // back / forward" is blocked (native listener, because the page's handler must be allowed to cancel the event), even when there is only one slide.
    const boxRef = useRef(null);
    useEffect(() => {
        const el = boxRef.current;
        if (!el || !el.addEventListener) return undefined;
        let acc = 0; let lockUntil = 0;
        const onWheel = (e) => {
            if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // an up/down scroll is not a swipe: the page scrolls as usual
            e.preventDefault();
            if (n < 2) return;
            const now = Date.now();
            if (now < lockUntil) return;
            acc += e.deltaX;
            if (Math.abs(acc) < 50) return;
            setCur((i) => (acc > 0 ? (i + 1) % n : (i - 1 + n) % n));
            acc = 0; lockUntil = now + 700;
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [n]);

    const b = list[Math.min(cur, n - 1)];
    if (!b) return null;
    const hasImg = !!b.image;
    const fg = hasImg ? '#FFFFFF' : onColor(primaryLight);
    return (
        <View ref={boxRef} style={{ overscrollBehaviorX: 'none' }}>
            <View style={{ height: 250, borderRadius: 18, overflow: 'hidden', backgroundColor: primaryDark }}>
                {hasImg ? (
                    <>
                        <Image key={b._id || cur} source={{ uri: b.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={500} />
                        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.80)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.04)']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
                    </>
                ) : (
                    <LinearGradient pointerEvents="none" colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                )}
                <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32, maxWidth: '75%' }}>
                    <Text numberOfLines={2} style={{ color: fg, fontSize: 32, lineHeight: 38, fontWeight: '900', letterSpacing: -0.5 }}>{b.title}</Text>
                    {b.subtitle ? <Text numberOfLines={2} style={{ color: fg, opacity: 0.9, fontSize: 15, lineHeight: 21, marginTop: 8 }}>{b.subtitle}</Text> : null}
                    <Pressable
                        onPress={() => onOrder(b)}
                        style={({ hovered }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 20, borderRadius: 20, marginTop: 18, backgroundColor: fg, transform: [{ scale: hovered ? 1.05 : 1 }], cursor: 'pointer' })}
                    >
                        <Text style={{ color: onColor(fg), fontSize: 14, fontWeight: '900' }}>{tr('Order now')}</Text>
                        <Ionicons name="arrow-forward" size={15} color={onColor(fg)} style={{ marginLeft: 7 }} />
                    </Pressable>
                </View>
            </View>
            {n > 1 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12 }}>
                    {list.map((x, i) => (
                        <Pressable key={x._id || i} onPress={() => setCur(i)} hitSlop={{ top: 8, bottom: 8, left: 3, right: 3 }} style={{ marginHorizontal: 4, cursor: 'pointer' }} accessibilityLabel={`${i + 1}`}>
                            <View style={{ width: i === cur ? 24 : 7, height: 7, borderRadius: 4, backgroundColor: i === cur ? primary : border }} />
                        </Pressable>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

/* ---------------- visit us: the shop's address, drawn the way the shop chose (card | list | chip | banner) ---------------- */
function VisitBar() {
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, surface, border } = useBrand();
    const variant = useThemeStore((st) => st.theme.locationStyle) || 'card';
    const spot = useStoreSpot();
    if (!spot.on || (!spot.address && !spot.pinned)) return null;
    const go = spot.pinned ? () => openDirections(spot) : undefined;
    const addr = spot.address || tr('On the map');
    const T = { transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '180ms' };

    // chip: one small pill
    if (variant === 'chip') {
        return (
            <View style={{ flexDirection: 'row', marginBottom: 18 }}>
                <Pressable
                    onPress={go} disabled={!go} accessibilityRole={go ? 'button' : 'text'}
                    style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', maxWidth: '100%', height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: hovered && go ? primary : border, backgroundColor: hovered && go ? tint(primary) : surface, cursor: go ? 'pointer' : 'default', ...T })}
                >
                    <Ionicons name="location-sharp" size={16} color={primary} />
                    <Text numberOfLines={1} style={{ flexShrink: 1, color: text, fontSize: 14, fontWeight: '700', marginLeft: 8 }}>{addr}</Text>
                    {go ? (
                        <>
                            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: muted, marginHorizontal: 10 }} />
                            <Ionicons name="navigate" size={15} color={primary} />
                            <Text style={{ color: primary, fontSize: 13.5, fontWeight: '900', marginLeft: 5 }}>{tr('Directions')}</Text>
                        </>
                    ) : null}
                </Pressable>
            </View>
        );
    }
    // list: a slim row between two thin lines
    if (variant === 'list') {
        return (
            <Pressable
                onPress={go} disabled={!go} accessibilityRole={go ? 'button' : 'text'}
                style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, marginBottom: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: border, backgroundColor: hovered && go ? tint(primary) : 'transparent', cursor: go ? 'pointer' : 'default', ...T })}
            >
                {({ hovered }) => (
                    <>
                        <Ionicons name={spot.pinned ? 'storefront-outline' : 'location-outline'} size={22} color={primary} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                            <Text numberOfLines={2} style={{ color: text, fontSize: 15, fontWeight: '800' }}>{addr}</Text>
                            {go ? <Text style={{ color: primary, fontSize: 12.5, fontWeight: '700', marginTop: 2 }}>{tr('Click for directions')}</Text> : null}
                        </View>
                        {go ? (
                            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: hovered ? 4 : 0 }], ...T }}>
                                <Ionicons name="navigate" size={17} color={onPrimary} />
                            </View>
                        ) : null}
                    </>
                )}
            </Pressable>
        );
    }
    // banner: a full-width strip in the shop's colour
    if (variant === 'banner') {
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderRadius: 16, marginBottom: 18, overflow: 'hidden' }}>
                <LinearGradient pointerEvents="none" colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                <Ionicons name="location-sharp" size={22} color={onPrimary} />
                <Text numberOfLines={2} style={{ flex: 1, color: onPrimary, fontSize: 15.5, fontWeight: '800', marginLeft: 12 }}>{addr}</Text>
                {go ? (
                    <Pressable onPress={go} accessibilityRole="button" style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', height: 38, paddingHorizontal: 18, borderRadius: 19, backgroundColor: onPrimary, transform: [{ scale: hovered ? 1.05 : 1 }], cursor: 'pointer', ...T })}>
                        <Ionicons name="navigate" size={15} color={primary} />
                        <Text style={{ color: primary, fontSize: 13.5, fontWeight: '900', marginLeft: 6 }}>{tr('Get directions')}</Text>
                    </Pressable>
                ) : null}
            </View>
        );
    }
    // card (the default): a wide bar with an icon, the address and a round arrow
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, marginBottom: 18, borderWidth: 1, borderColor: `${primary}40`, overflow: 'hidden' }}>
            <LinearGradient pointerEvents="none" colors={[`${primary}2E`, `${primary}0F`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: `${primary}33`, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={spot.pinned ? 'storefront-outline' : 'location-outline'} size={20} color={primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: muted, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.2 }}>{spot.pinned ? tr('VISIT US') : tr('FIND US')}</Text>
                <Text numberOfLines={2} style={{ color: text, fontSize: 15, fontWeight: '800', marginTop: 2 }}>{addr}</Text>
            </View>
            {go ? (
                <Pressable
                    onPress={go}
                    accessibilityRole="button"
                    accessibilityLabel={tr('Get directions')}
                    style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', transform: [{ scale: hovered ? 1.08 : 1 }], cursor: 'pointer' })}
                >
                    <Ionicons name="arrow-forward" size={19} color={onPrimary} />
                </Pressable>
            ) : null}
        </View>
    );
}

/* ---------------- categories: photo tiles, 4 across ---------------- */
// The tile itself never moves or changes size: only the photo inside it grows a little on hover (and brightens), and the tile's rounded edge
// clips it. Scaling the whole tile made its edge and its backing colour show as a thin border. The selected ring is a layer on top, so it
// never changes the tile's size either.
function CatTile({ c, on, onPress, w, h }) {
    const { primary, primaryLight, primaryDark, onPrimary } = useBrand();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden', cursor: 'pointer', isolation: 'isolate', backgroundColor: '#111111' }}
        >
            {({ hovered }) => (
                <>
                    <View
                        pointerEvents="none"
                        style={[StyleSheet.absoluteFill, {
                            transform: [{ scale: hovered ? 1.09 : 1 }], filter: hovered ? 'brightness(1.12)' : 'brightness(1)',
                            transitionProperty: 'transform, filter', transitionDuration: '380ms', transitionTimingFunction: 'cubic-bezier(0.22, 0.7, 0.2, 1)',
                        }]}
                    >
                        {c.image ? <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : (
                            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: 24 }]}>
                                <Text style={{ color: '#FFFFFF', fontSize: Math.round(h / 2.6), fontWeight: '900', opacity: 0.85 }}>{(c.name || '?')[0].toUpperCase()}</Text>
                            </LinearGradient>
                        )}
                    </View>
                    <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />
                    <Text numberOfLines={2} style={{ position: 'absolute', left: 10, right: 10, bottom: 12, textAlign: 'center', color: '#FFFFFF', fontSize: 20, lineHeight: 24, fontWeight: '900' }}>{c.name}</Text>
                    {on ? (
                        <>
                            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 16, borderWidth: 3, borderColor: primary }]} />
                            <View style={{ position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="checkmark" size={14} color={onPrimary} />
                            </View>
                        </>
                    ) : null}
                </>
            )}
        </Pressable>
    );
}

// a round photo with the name under it (the shop's "circles" look)
function CatCircle({ c, on, onPress, size }) {
    const { primary, primaryLight, primaryDark, onPrimary, text } = useBrand();
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ width: size + 24, alignItems: 'center', cursor: 'pointer' }}>
            {({ hovered }) => (
                <>
                    <View
                        style={{
                            width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: '#111111', borderWidth: 3, borderColor: on || hovered ? primary : 'transparent',
                            boxShadow: hovered ? `0 8px 20px ${primary}40` : '0 0 0 rgba(0,0,0,0)', transform: [{ scale: hovered ? 1.06 : 1 }], transitionProperty: 'transform, border-color, box-shadow', transitionDuration: '200ms',
                        }}
                    >
                        {c.image ? <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : (
                            <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                                <Text style={{ color: '#FFFFFF', fontSize: Math.round(size / 2.4), fontWeight: '900', opacity: 0.9 }}>{(c.name || '?')[0].toUpperCase()}</Text>
                            </LinearGradient>
                        )}
                        {on ? <View pointerEvents="none" style={{ position: 'absolute', right: 4, bottom: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={14} color={onPrimary} /></View> : null}
                    </View>
                    <Text numberOfLines={2} style={{ marginTop: 9, textAlign: 'center', fontSize: size > 100 ? 15 : 13.5, lineHeight: size > 100 ? 19 : 17, fontWeight: on ? '900' : '700', color: on || hovered ? primary : text, transitionProperty: 'color', transitionDuration: '160ms' }}>{c.name}</Text>
                </>
            )}
        </Pressable>
    );
}

// a pill with a small round photo (the shop's "pills" look)
function CatPill({ c, on, onPress, h }) {
    const { primary, primaryLight, primaryDark, onPrimary, text, surface, border } = useBrand();
    const ph = h - 12;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={({ hovered }) => ({
                flexDirection: 'row', alignItems: 'center', height: h, paddingLeft: 6, paddingRight: 20, borderRadius: h / 2, borderWidth: 1.5, flexShrink: 0,
                borderColor: on || hovered ? primary : border, backgroundColor: on ? primary : hovered ? tint(primary) : surface,
                boxShadow: on ? `0 6px 16px ${primary}40` : hovered ? `0 4px 12px ${primary}26` : '0 0 0 rgba(0,0,0,0)', transform: [{ scale: hovered && !on ? 1.04 : 1 }],
                cursor: 'pointer', transitionProperty: 'background-color, border-color, box-shadow, transform', transitionDuration: '180ms',
            })}
        >
            <View style={{ width: ph, height: ph, borderRadius: ph / 2, overflow: 'hidden', backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
                {c.image ? <Image source={{ uri: c.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : (
                    <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ color: '#FFFFFF', fontSize: Math.round(ph / 2.1), fontWeight: '900' }}>{(c.name || '?')[0].toUpperCase()}</Text>
                    </LinearGradient>
                )}
            </View>
            <Text numberOfLines={1} style={{ color: on ? onPrimary : text, fontSize: 15, fontWeight: '800', marginLeft: 10 }}>{c.name}</Text>
            {on ? <Ionicons name="checkmark-circle" size={17} color={onPrimary} style={{ marginLeft: 8 }} /> : null}
        </Pressable>
    );
}

// The categories, drawn the way the shop chose (circles | photo tiles | pills). The shop can also tick "Categories scroll sideways on the website":
// then they are ONE medium-size row you scroll sideways (like the phone), with arrows at the ends, instead of the big wrapping grid.
function CategoryGrid({ chips, width, onPick }) {
    const sel = useFilterStore((s) => s.categories);
    const toggle = useFilterStore((s) => s.toggleCategory);
    const clear = useFilterStore((s) => s.clearCategories);
    const style = useThemeStore((st) => st.theme.categoryStyle) || 'circles';
    const scroll = useThemeStore((st) => st.theme.categoryScroll) === true;
    const { primary, surface, border, text } = useBrand();
    const ref = useRef(null);
    const [m, setM] = useState({ x: 0, view: 0, total: 0 });   // how far it is scrolled, how wide the window is, how wide the row is
    const pick = (id) => { toggle(id); onPick(); };

    const item = (c, big) => {
        const id = String(c._id);
        const on = sel.includes(id);
        if (style === 'circles') return <CatCircle key={id} c={c} on={on} size={big ? 118 : 84} onPress={() => pick(id)} />;
        if (style === 'pills') return <CatPill key={id} c={c} on={on} h={big ? 54 : 46} onPress={() => pick(id)} />;
        const cols = width >= 900 ? 4 : 3;
        const w = big ? Math.floor((Math.max(width, 320) - GAP * (cols - 1)) / cols) : 196;
        return <CatTile key={id} c={c} w={w} h={Math.round(w / (big ? 1.4 : 1.6))} on={on} onPress={() => pick(id)} />;
    };

    const clearBtn = sel.length ? (
        <Pressable onPress={clear} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginBottom: 10, opacity: hovered ? 0.7 : 1, cursor: 'pointer' })}>
            <Ionicons name="close-circle" size={17} color={primary} />
            <Text style={{ color: primary, fontWeight: '800', fontSize: 14, marginLeft: 5 }}>{tr('Clear all')}</Text>
        </Pressable>
    ) : null;

    if (!scroll) {
        // the grid: wraps over as many rows as it needs
        return (
            <View style={{ marginBottom: 30 }}>
                {clearBtn}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: style === 'circles' ? 10 : style === 'pills' ? 12 : GAP }}>{chips.map((c) => item(c, true))}</View>
            </View>
        );
    }

    const canL = m.x > 4;
    const canR = m.x + m.view < m.total - 4;
    const arrow = (dir) => (
        <Pressable
            onPress={() => ref.current?.scrollTo?.({ x: Math.max(0, m.x + dir * Math.max(240, m.view * 0.7)), animated: true })}
            accessibilityRole="button"
            accessibilityLabel={dir < 0 ? tr('Previous') : tr('Next')}
            style={({ hovered }) => ({
                position: 'absolute', top: '50%', marginTop: -20, [dir < 0 ? 'left' : 'right']: -6, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', zIndex: 5,
                backgroundColor: hovered ? primary : surface, borderWidth: 1, borderColor: hovered ? primary : border, boxShadow: '0 6px 18px rgba(0,0,0,0.22)', cursor: 'pointer',
                transform: [{ scale: hovered ? 1.08 : 1 }], transitionProperty: 'background-color, border-color, transform', transitionDuration: '160ms',
            })}
        >
            {({ hovered }) => <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={20} color={hovered ? '#FFFFFF' : text} />}
        </Pressable>
    );
    return (
        <View style={{ marginBottom: 24 }}>
            {clearBtn}
            <View onLayout={(e) => { const v = Math.round(e.nativeEvent.layout.width); setM((o) => (o.view === v ? o : { ...o, view: v })); }}>
                <ScrollView
                    ref={ref}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={32}
                    onScroll={(e) => { const x = Math.round(e.nativeEvent.contentOffset.x); setM((o) => (Math.abs(o.x - x) < 3 ? o : { ...o, x })); }}
                    onContentSizeChange={(w) => setM((o) => (o.total === w ? o : { ...o, total: w }))}
                    contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 6, gap: style === 'circles' ? 6 : 12, alignItems: style === 'circles' ? 'flex-start' : 'center' }}
                    style={{ marginHorizontal: -6 }}
                >
                    {chips.map((c) => item(c, false))}
                </ScrollView>
                {canL ? arrow(-1) : null}
                {canR ? arrow(1) : null}
            </View>
        </View>
    );
}

/* ---------------- the page ---------------- */
export default function HomeDesktop() {
    const nav = useNavigation();
    const brand = useBrand();
    const closedStyle = useClosedStyle();
    const user = useAuthStore((s) => s.user);
    const { config, full, categories: chips, banners, offers: allOffers } = useHomeStore();
    const { categories: menuCats, recommended, festival, combo, loaded, errorStatus, load: loadMenu } = useMenuStore();
    const f = useFilterStore();
    const [dlg, setDlg] = useState(false);
    const [colW, setColW] = useState(DESKTOP_PAGE_MAX - 48);   // measured below; this is only the first guess
    const menuRef = useRef(null);

    // the same loading the phone's Home does (it is not mounted on the desktop)
    useEffect(() => { useOrderMode.getState().load(); }, []);
    useFocusEffect(useCallback(() => { if (user) useAddressStore.getState().refresh(); }, [user?.id || user?._id || null]));   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!user) useAddressStore.getState().clear(); }, [user]);
    useEffect(() => { useCartStore.getState().hydrate(); loadMenu(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (user && full.features.favourites) useFavStore.getState().load();
        else useFavStore.getState().reset();
    }, [user, full.features.favourites]);
    useEffect(() => { useHomeStore.getState().loadOffers(); }, [user?.id || user?._id || null]);   // eslint-disable-line react-hooks/exhaustive-deps

    const modes = modesOf(full);
    const picked = useOrderMode((s) => s.mode);
    const mode = modes.length > 1 ? (modes.includes(picked) ? picked : modes[0]) : (modes[0] || 'delivery');
    const dineMode = mode === 'dine_in' && modes.includes('dine_in');
    const offers = useMemo(() => (dineMode ? allOffers : allOffers.filter((o) => !o.dineInOnly)), [allOffers, dineMode]);

    const all = useMemo(() => menuCats.flatMap((c) => c.items), [menuCats]);
    const filtered = useMemo(
        () => applyFilters(all, { categories: f.categories, active: f.active, sort: f.sort, price: f.price, spice: f.spice, serves: f.serves, weight: f.weight }, full.ratings.minCount),
        [all, f.categories, f.active, f.sort, f.price, f.spice, f.serves, f.weight, full.ratings.minCount],
    );
    const showStrips = f.categories.length === 0;
    const vegOnly = f.active.includes('veg_only');
    const keep = (list) => (vegOnly ? list.filter((p) => p.isVeg) : list);
    const waiting = !loaded && !errorStatus;
    const cardMin = config.cardStyle === 'big' ? 300 : config.cardStyle === 'compact' ? 360 : CARD_MIN;   // wider cards: fewer across
    const cols = Math.max(1, Math.min(config.cardStyle === 'big' ? 3 : config.cardStyle === 'compact' ? 3 : 5, Math.floor((colW + GAP) / (cardMin + GAP))));
    const toMenu = () => { try { menuRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); } catch (e) { /* stay */ } };
    const onOrder = (b) => { if (b.couponCode) nav.navigate('Offers'); else toMenu(); };

    // the banner sits beside the title; it is there only when the shop's banner block is on and it has banners (or they are still loading)
    const bannerOn = (config.blocks || []).includes('banner');
    const hero = bannerOn && banners.length ? <Hero list={banners} onOrder={onOrder} />
        : bannerOn && waiting ? <View style={{ height: 250, borderRadius: 18, backgroundColor: brand.surface }} /> : null;

    // the dish card follows the shop's choice: Big (wide, large photo), Grid (the standard desktop card) or Compact (text left, small photo right)
    const cardKind = config.cardStyle === 'big' ? 'deskBig' : config.cardStyle === 'compact' ? 'deskCompact' : 'desk';
    const card = (item) => <ItemCard key={item._id} item={item} variant={cardKind} />;
    const blocks = [];
    for (const b of config.blocks || []) {
        if (b === 'categories' && chips.length) {
            blocks.push(<CategoryGrid key="cats" chips={chips} width={colW} onPick={toMenu} />);
        } else if (b === 'filters') {
            blocks.push(<View key="filters" style={{ marginBottom: 18, marginHorizontal: -16 }}><FiltersRow onOpen={() => setDlg(true)} /></View>);   // the row has 16 px of its own padding: pull it back onto the grid's edge
        } else if (b === 'offers' && showStrips && offers.length && full.offers.couponsEnabled && full.offers.showOnHome) {
            const oc = Math.max(1, Math.min(3, Math.floor((colW - 40 + GAP) / (360 + GAP))));
            blocks.push(
                <View key="offers" style={{ marginBottom: 34, padding: 22, borderRadius: 26, borderWidth: 1, borderColor: `${brand.primary}33`, overflow: 'hidden' }}>
                    <LinearGradient pointerEvents="none" colors={[`${brand.primary}1F`, `${brand.primary}08`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                    <SecHead icon="pricetags" title={tr('Offers for you')} sub={tr('Tap a code to use it at checkout')} onSee={() => nav.navigate('Offers')} />
                    <Grid items={offers.slice(0, oc * 2)} cols={oc} render={(o) => <CouponTicket key={o._id} o={o} size="desk" onPress={() => nav.navigate('Offers')} />} />
                </View>,
            );
        } else if (!showStrips && ['bestsellers', 'festival', 'combos', 'new_arrivals'].includes(b)) {
            continue;
        } else if (b === 'bestsellers' && keep(recommended).length) {
            blocks.push(<Strip key="best" icon="flame" title={tr('Bestsellers')} sub={tr('Most ordered')} items={keep(recommended)} cols={cols} render={card} onSee={() => nav.navigate('Bestsellers')} />);
        } else if (b === 'festival') {
            festival.forEach((c) => { const items = keep(c.products); if (items.length) blocks.push(<Strip key={`f${c.id}`} icon="gift" title={c.title} sub={c.subtitle || ''} items={items} cols={cols} render={card} />); });
        } else if (b === 'combos') {
            combo.forEach((c) => { const items = keep(c.products); if (items.length) blocks.push(<Strip key={`c${c.id}`} icon="fast-food" title={c.title} sub={c.subtitle || ''} items={items} cols={cols} render={card} />); });
        } else if (b === 'new_arrivals') {
            const news = keep(all.filter((i) => i.isNewArrival)).slice(0, 10);
            if (news.length) blocks.push(<Strip key="new" icon="sparkles" title={tr('New arrivals')} sub={tr('Just added')} items={news} cols={cols} render={card} />);
        } else if (b === 'items') {
            blocks.push(
                <View key="items" ref={menuRef}>
                    {!loaded ? <SkelFeed variant="grid" count={cols * 2} />
                        : !all.length && errorStatus ? (
                            <Notice icon="cloud-offline-outline" text={tr('Could not load the menu')} action={tr('Try again')} onAction={loadMenu} />
                        ) : !filtered.length ? <Notice icon="restaurant-outline" text={tr(full.labels.emptySearch)} />
                            : full.menu.groupByCategory ? (() => {
                                const by = new Map();
                                filtered.forEach((p) => { const k = String(p.categoryId); if (!by.has(k)) by.set(k, []); by.get(k).push(p); });
                                return menuCats.map((c) => {
                                    const A = by.get(String(c._id));
                                    if (!A?.length) return null;
                                    return <Strip key={c._id} title={c.name} sub={tr('{n} items', { n: A.length })} items={A} cols={cols} render={card} all />;
                                });
                            })() : (
                                <Strip
                                    title={chips.filter((c) => f.categories.includes(String(c._id))).map((c) => c.name).join(', ') || tr('Full menu')}
                                    sub={tr('{n} dishes', { n: filtered.length })} items={filtered} cols={cols} render={card} all
                                />
                            )}
                </View>,
            );
        }
    }

    return (
        <View style={[{ flex: 1, backgroundColor: brand.background }, closedStyle]}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
                <View style={{ width: '100%', maxWidth: DESKTOP_PAGE_MAX, alignSelf: 'center', paddingHorizontal: 24 }}>
                    <View onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w && Math.abs(w - colW) > 1) setColW(w); }}>
                        <Header mode={mode} hero={hero} />
                        {full.restaurant.isOpen ? null : (
                            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: brand.errorSoft, marginBottom: 18 }}>
                                <Ionicons name="moon-outline" size={17} color={brand.errorText} />
                                <Text style={{ color: brand.errorText, fontWeight: '700', fontSize: 14.5, marginLeft: 10 }}>{closedText(full)}</Text>
                            </View>
                        )}
                        <VisitBar />
                        <BranchChip />
                        {dineMode ? <View style={{ marginBottom: 24 }}><DineBusyNote /><DineHomeCard /></View> : null}
                        {blocks}
                    </View>
                </View>
            </ScrollView>
            <BulkCartBar />
            <FilterDialog visible={dlg} onClose={() => setDlg(false)} items={all} />
        </View>
    );
}

// a titled grid of dishes, shown up to two rows unless it is the whole menu (`all`)
function Strip({ title, sub, items, cols, render, onSee, all = false, icon }) {
    const shown = all ? items : items.slice(0, cols * 2);
    return (
        <View style={{ marginBottom: 30 }}>
            <SecHead icon={icon} title={title} sub={sub} onSee={onSee} />
            <Grid items={shown} cols={cols} render={render} />
        </View>
    );
}

function Notice({ icon, text, action, onAction }) {
    const { muted, primary } = useBrand();
    return (
        <View style={{ alignItems: 'center', padding: 48 }}>
            <Ionicons name={icon} size={38} color={muted} />
            <Text style={{ color: muted, fontSize: 16, marginTop: 12 }}>{text}</Text>
            {action ? <Pressable onPress={onAction} style={{ marginTop: 12, cursor: 'pointer' }}><Text style={{ color: primary, fontWeight: '800' }}>{action}</Text></Pressable> : null}
        </View>
    );
}
