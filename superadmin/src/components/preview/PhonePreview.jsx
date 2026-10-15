// A working copy of the customer app, drawn from the settings being edited.
//
// It is NOT a picture. Every screen of the customer app exists here and can be opened by tapping through it, or
// from the "Screens" bar: Login, Home, Search (and results), a dish page, Cart (and empty cart), Payment options,
// Card details, Order placed, Orders, a live order, a delivered order, Offers, Favourites, Bestsellers,
// Notifications, Account, the address sheet, edit profile, the filters, and a "shop closed" state.
//
// Everything the panel can change (look, colours, header, categories, cards, tabs, filters, labels, fonts, button
// shape, the shop name and logo...) is read from `config` on every render, so an edit shows up at once.
// The dishes, offers, orders and the customer are dummy content (previewData.js).
//
// It mirrors mobile/src/screens/customers. When the customer app's design changes, this file is the place to bring
// the preview in line.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, Animated, Easing, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font } from '../../theme';
import { CATEGORIES, DISHES, BANNERS, OFFERS, ORDERS, STEPS, USER } from './previewData';

/* ============================== colours (the same rules as the customer app's kit.jsx) ============================== */
const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(c || '');
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (a) => `#${a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const mix = (a, b, t) => (isHex(a) && isHex(b) ? toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t)) : a);
const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = (c) => { const [r, g, b] = rgb(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const onColor = (c) => (isHex(c) && lum(c) > 0.6 ? '#1A1A1A' : '#FFFFFF');
const alpha = (c, a) => (isHex(c) ? `${c}${Math.round(a * 255).toString(16).padStart(2, '0')}` : c);
const HAIR = StyleSheet.hairlineWidth;

const RADIUS = { rounded: 12, pill: 99, square: 3 };

// The same fonts the customer app uses (one file per weight, because Android needs that):
//   classic = Lora, rounded = Nunito, modern = Inter (only when the look is not "bold", exactly like the app)
const FONT_MAP = {
    Inter_400: require('@expo-google-fonts/inter/400Regular').Inter_400Regular,
    Inter_500: require('@expo-google-fonts/inter/500Medium').Inter_500Medium,
    Inter_600: require('@expo-google-fonts/inter/600SemiBold').Inter_600SemiBold,
    Inter_700: require('@expo-google-fonts/inter/700Bold').Inter_700Bold,
    Inter_800: require('@expo-google-fonts/inter/800ExtraBold').Inter_800ExtraBold,
    Lora_400: require('@expo-google-fonts/lora/400Regular').Lora_400Regular,
    Lora_500: require('@expo-google-fonts/lora/500Medium').Lora_500Medium,
    Lora_600: require('@expo-google-fonts/lora/600SemiBold').Lora_600SemiBold,
    Lora_700: require('@expo-google-fonts/lora/700Bold').Lora_700Bold,
    Nunito_400: require('@expo-google-fonts/nunito/400Regular').Nunito_400Regular,
    Nunito_600: require('@expo-google-fonts/nunito/600SemiBold').Nunito_600SemiBold,
    Nunito_700: require('@expo-google-fonts/nunito/700Bold').Nunito_700Bold,
    Nunito_800: require('@expo-google-fonts/nunito/800ExtraBold').Nunito_800ExtraBold,
};
const FAMILY_WEIGHTS = { Inter: [400, 500, 600, 700, 800], Lora: [400, 500, 600, 700], Nunito: [400, 600, 700, 800] };
const familyFor = (fontStyle, look) => (fontStyle === 'classic' ? 'Lora' : fontStyle === 'rounded' ? 'Nunito' : (look !== 'bold' ? 'Inter' : null));
const pickFont = (family, w) => {
    const ws = FAMILY_WEIGHTS[family];
    let best = ws[0];
    ws.forEach((x) => { if (x <= w) best = x; });
    return `${family}_${best}`;
};

function tokens(brand, forceDark) {
    const c = brand.colors || {};
    const look = forceDark ? brand.darkLook : brand.lightLook;   // the shop has one theme for light mode and one for dark mode
    const basePrimary = isHex(c.primary) ? c.primary : '#E23744';
    const L = look === 'midnight'
        ? { background: mix('#101013', basePrimary, 0.07), surface: mix('#1C1C21', basePrimary, 0.1), text: '#F6F2F2' }
        : look === 'fresh' ? { background: '#F6F6F8', surface: '#FFFFFF', text: '#1B1B1F' }
            : look === 'cream' ? { background: '#FBF5EA', surface: '#FFFDF8', text: '#2A2118' }
                : look === 'mist' ? { background: '#EEF3F8', surface: '#FFFFFF', text: '#16202B' }
                    : look === 'charcoal' ? { background: '#1A1B21', surface: '#25272F', text: '#F0F0F3' }
                        : look === 'black' ? { background: '#000000', surface: '#121214', text: '#F2F2F4' }
                            : look === 'slate' ? { background: '#0F172A', surface: '#1B2438', text: '#E8EEF8' } : null;
    const background = L ? L.background : (isHex(c.background) ? c.background : '#FFFFFF');
    const text = L ? L.text : (isHex(c.text) ? c.text : '#1C1C1C');
    const dark = lum(background) < 0.3;
    const lift = (x) => (L && dark && isHex(x) && lum(x) < 0.12 ? mix(x, '#FFFFFF', 0.3) : x);
    const primary = lift(basePrimary);
    const surface = L ? L.surface : dark ? mix(background, '#FFFFFF', 0.07) : (lum(background) > 0.9 ? '#FFFFFF' : mix(background, '#FFFFFF', 0.6));
    const accent = isHex(c.accent) ? c.accent : '#F59E0B';
    const err = isHex(c.error) ? c.error : '#B3261E';
    return {
        look, dark, primary, background, surface, text, accent,
        primaryLight: isHex(c.primaryLight) ? lift(c.primaryLight) : mix(primary, '#FFFFFF', 0.12),
        primaryDark: isHex(c.primaryDark) ? lift(c.primaryDark) : mix(primary, '#000000', 0.15),
        onPrimary: onColor(primary), onAccent: onColor(accent),
        border: dark ? mix(surface, '#FFFFFF', 0.11) : mix(background, text, 0.12),
        muted: mix(background, text, dark ? 0.62 : 0.55),
        soft: mix(background, primary, dark ? 0.18 : 0.1),
        wash: mix(background, primary, dark ? 0.42 : 0.16),
        ok: dark ? '#4ADE80' : '#1E8E3E',
        errorText: dark ? '#FF8A80' : err,
        errorSoft: dark ? alpha('#FF6B6B', 0.16) : alpha(err, 0.1),
        radius: RADIUS[brand.buttonShape] ?? 12,
        family: familyFor(brand.fontStyle, look),
    };
}

/* ============================== the settings the preview reads ============================== */
const DARK_IDS = ['midnight', 'charcoal', 'black', 'slate'];
const addressText = (a) => (typeof a === 'string' ? a.trim() : [a?.line, a?.city, a?.pincode].filter(Boolean).join(', '));

function normalize(c) {
    const cfg = c || {};
    const b = cfg.brand || {};
    const h = cfg.home || {};
    const blocks = (h.blocks || [])
        .filter((x) => typeof x === 'string' || x.enabled !== false)
        .map((x) => (typeof x === 'string' ? x : x.type));
    if (!blocks.includes('items')) blocks.push('items');
    const tabs = Array.isArray(cfg.tabs) && cfg.tabs.length ? cfg.tabs.slice() : ['home', 'search', 'orders', 'profile'];
    if (!tabs.includes('home')) tabs.unshift('home');
    return {
        name: cfg.restaurant?.name || 'Your shop',
        logo: cfg.restaurant?.logo || '',
        // where the shop is: an address, and a map pin if it was pinned
        address: addressText(cfg.restaurant?.address),
        pinned: Number.isFinite(cfg.restaurant?.latitude) && Number.isFinite(cfg.restaurant?.longitude),
        directions: cfg.features?.directions !== false,
        tagline: cfg.restaurant?.tagline || 'Delicious food, delivered to your door',
        open: cfg.restaurant?.isOpen !== false,
        brand: {
            colors: b.colors || {}, fontStyle: b.fontStyle || 'modern', buttonShape: b.buttonShape || 'rounded',
            // a shop that only has the old single "look" still works: a light one is its light theme, "midnight" meant fresh + midnight
            lightLook: b.lightLook || (b.look && !DARK_IDS.includes(b.look) ? b.look : (b.look ? 'fresh' : 'bold')),
            darkLook: b.darkLook || (DARK_IDS.includes(b.look) ? b.look : 'midnight'),
            motion: b.motion || 'full', headerStyle: b.headerStyle || 'hero', tabBarStyle: b.tabBarStyle || 'classic',
            categoryStyle: b.categoryStyle || 'circles', filterStyle: b.filterStyle || 'dialog', locationStyle: b.locationStyle || 'card',
        },
        tabs,
        blocks,
        cardStyle: h.cardStyle || 'big',
        foodMode: h.foodMode || 'mixed',
        itemOptions: h.itemOptions || { sizes: true, addOns: true },
        features: cfg.features || {},
        labels: {
            addButton: cfg.labels?.addButton || 'Add', orderButton: cfg.labels?.orderButton || 'Place order',
            emptyCart: cfg.labels?.emptyCart || 'Your cart is empty', closed: cfg.labels?.closedMessage || 'We are closed right now',
        },
        orders: cfg.orders || {},
        offers: { enabled: cfg.offers?.couponsEnabled !== false, onHome: cfg.offers?.showOnHome !== false },
        grouped: cfg.menu?.groupByCategory !== false,
    };
}

const Ctx = createContext(null);
const useP = () => useContext(Ctx);

// Text that uses the shop's font style: it picks the weight of the family from the style's fontWeight
function Tx({ style, children, ...rest }) {
    const { T, fonts } = useP();
    let face = null;
    if (T.family && fonts) {
        const flat = StyleSheet.flatten(style) || {};
        const w = flat.fontWeight === 'bold' ? 700 : parseInt(flat.fontWeight, 10) || 400;
        face = { fontFamily: pickFont(T.family, w), fontWeight: 'normal' };
    }
    return <Text {...rest} style={[style, face]}>{children}</Text>;
}

/* ============================== phone geometry ============================== */
const W = 320;
const H = 640;
const STATUS = 26;
const FRAME = 6;

/* ============================== shared pieces ============================== */
function Photo({ emoji, size, radius = 14, style }) {
    const { T } = useP();
    return (
        <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: T.soft, alignItems: 'center', justifyContent: 'center' }, style]}>
            <Text style={{ fontSize: size * 0.5 }}>{emoji}</Text>
        </View>
    );
}

function VegDot({ veg }) {
    const c = veg ? '#0F8A3C' : '#B3261E';
    return <View style={{ width: 12, height: 12, borderWidth: 1.5, borderColor: c, borderRadius: 3, alignItems: 'center', justifyContent: 'center', marginRight: 6 }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c }} /></View>;
}

function AddBtn({ kind = 'pill' }) {
    const { T, C } = useP();
    const label = String(C.labels.addButton).toUpperCase();
    if (kind === 'circle') {
        return <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={18} color={T.onPrimary} /></View>;
    }
    if (kind === 'outline') {
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: T.primary, borderRadius: T.radius, paddingHorizontal: 18, paddingVertical: 8 }}>
                <Tx style={{ color: T.primary, fontSize: 11, fontWeight: '800' }}>{label}</Tx>
            </View>
        );
    }
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.primary, borderRadius: T.radius, paddingHorizontal: 18, paddingVertical: 10 }}>
            <Tx style={{ color: T.onPrimary, fontSize: 11, fontWeight: '800' }}>{label}</Tx>
            <Ionicons name="add" size={13} color={T.onPrimary} style={{ marginLeft: 2 }} />
        </View>
    );
}

function Glow({ radius = 16 }) {
    const { T } = useP();
    if (!T.dark || T.look === 'bold') return null;
    return <LinearGradient pointerEvents="none" colors={[alpha(T.primary, 0), alpha(T.primary, 0.2)]} start={{ x: 0.15, y: 0.1 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />;
}

function SecHead({ title, sub, onSee }) {
    const { T } = useP();
    return (
        <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 3, height: 22, borderRadius: 2, backgroundColor: T.primary, marginRight: 8 }} />
            <View style={{ flex: 1 }}>
                <Tx style={{ color: T.text, fontSize: 15, fontWeight: '900' }}>{title}</Tx>
                {sub ? <Tx style={{ color: T.muted, fontSize: 10.5 }}>{sub}</Tx> : null}
            </View>
            {onSee ? (
                <Pressable onPress={onSee} style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Tx style={{ color: T.primary, fontSize: 11, fontWeight: '800' }}>See all</Tx>
                    <Ionicons name="chevron-forward" size={12} color={T.primary} />
                </Pressable>
            ) : null}
        </View>
    );
}

// a full page: back arrow and title on top, content scrolls under it
function Page({ title, children, footer }) {
    const { T, nav } = useP();
    return (
        <View style={{ flex: 1, backgroundColor: T.background }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: HAIR, borderBottomColor: T.border }}>
                <Pressable onPress={nav.pop} hitSlop={10} style={{ paddingRight: 10 }}><Ionicons name="arrow-back" size={20} color={T.text} /></Pressable>
                <Tx numberOfLines={1} style={{ flex: 1, color: T.text, fontSize: 15, fontWeight: '800' }}>{title}</Tx>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: footer ? 90 : 24 }}>{children}</ScrollView>
            {footer || null}
        </View>
    );
}

function Dock({ children }) {
    const { T } = useP();
    return <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: T.surface, borderTopWidth: HAIR, borderTopColor: T.border, flexDirection: 'row', alignItems: 'center' }}>{children}</View>;
}

function Btn({ title, onPress, kind = 'primary', style, icon }) {
    const { T } = useP();
    const filled = kind === 'primary';
    const danger = kind === 'danger';
    return (
        <Pressable
            onPress={onPress}
            style={[{
                height: 44, borderRadius: T.radius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
                backgroundColor: filled ? T.primary : 'transparent', borderWidth: filled ? 0 : 1.5, borderColor: danger ? T.errorText : T.border,
            }, style]}
        >
            {icon ? <Ionicons name={icon} size={16} color={filled ? T.onPrimary : danger ? T.errorText : T.primary} style={{ marginRight: 6 }} /> : null}
            <Tx style={{ color: filled ? T.onPrimary : danger ? T.errorText : T.text, fontSize: 13, fontWeight: '900' }}>{title}</Tx>
        </Pressable>
    );
}

function Card({ children, style }) {
    const { T } = useP();
    return (
        <View style={[{ backgroundColor: T.surface, borderColor: T.border, borderWidth: HAIR, borderRadius: 16, marginHorizontal: 14, marginTop: 10, padding: 12 }, style]}>
            <Glow radius={16} />
            {children}
        </View>
    );
}

function Field({ label, value, half }) {
    const { T } = useP();
    return (
        <View style={{ flex: half ? 1 : undefined, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 8 }}>
            <Tx style={{ color: T.muted, fontSize: 9.5, fontWeight: '700' }}>{label}</Tx>
            <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '700', marginTop: 1 }}>{value}</Tx>
        </View>
    );
}

/* ============================== dish cards, tiles, coupons ============================== */
function DishCard({ d, variant, onOpen, hearted }) {
    const { T, C } = useP();
    const showDot = C.features.vegDot !== false && C.foodMode === 'mixed';
    const off = d.mrp > d.price ? Math.round(100 - (d.price * 100) / d.mrp) : 0;
    const ribbon = T.look === 'bold' ? T.primary : T.accent;
    const onRibbon = T.look === 'bold' ? T.onPrimary : T.onAccent;
    const rated = C.features.ratingBadge !== false;
    const card = { backgroundColor: T.surface, borderColor: T.border, borderWidth: HAIR };
    const heart = C.features.favourites || hearted;

    if (variant === 'compact') {
        return (
            <Pressable onPress={onOpen} style={[s.compact, card]}>
                <Glow radius={16} />
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>{showDot ? <VegDot veg={d.veg} /> : null}<Tx numberOfLines={2} style={{ color: T.text, fontSize: 12.5, fontWeight: '800', flex: 1 }}>{d.name}</Tx></View>
                    {rated ? <View style={s.rate}><Tx style={s.rateTxt}>{d.rating}</Tx><Ionicons name="star" size={8} color="#FFFFFF" style={{ marginLeft: 2 }} /></View> : null}
                    <Tx style={{ color: T.text, fontSize: 13, fontWeight: '800', marginTop: 4 }}>₹{d.price}{off ? <Tx style={{ color: T.muted, fontSize: 10, textDecorationLine: 'line-through', fontWeight: '500' }}>  ₹{d.mrp}</Tx> : null}</Tx>
                    {off ? <Tx style={{ color: T.ok, fontSize: 10, fontWeight: '800', marginTop: 2 }}>{off}% off</Tx> : null}
                </View>
                <View style={{ width: 84 }}>
                    <Photo emoji={d.emoji} size={84} radius={14} />
                    {heart ? <View style={[s.heart, { top: 5, right: 5, width: 22, height: 22 }]}><Ionicons name={hearted ? 'heart' : 'heart-outline'} size={12} color={hearted ? T.primary : '#444444'} /></View> : null}
                    <View style={{ position: 'absolute', bottom: -10, alignSelf: 'center' }}><AddBtn kind="outline" /></View>
                </View>
            </Pressable>
        );
    }
    if (variant === 'grid') {
        return (
            <Pressable onPress={onOpen} style={[s.grid, card]}>
                <Glow radius={14} />
                <Photo emoji={d.emoji} size={134} radius={0} style={{ width: '100%', height: 84, borderTopLeftRadius: 14, borderTopRightRadius: 14 }} />
                {off ? <View style={[s.badge, { backgroundColor: ribbon }]}><Tx style={{ color: onRibbon, fontSize: 9, fontWeight: '900' }}>{off}% OFF</Tx></View> : null}
                <View style={{ padding: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>{showDot ? <VegDot veg={d.veg} /> : null}<Tx numberOfLines={1} style={{ color: T.text, fontSize: 11.5, fontWeight: '800', flex: 1 }}>{d.name}</Tx></View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '800' }}>₹{d.price}</Tx>
                        <AddBtn kind="circle" />
                    </View>
                </View>
            </Pressable>
        );
    }
    return (
        <Pressable onPress={onOpen} style={[s.big, card]}>
            <Glow radius={18} />
            <View>
                <Photo emoji={d.emoji} size={160} radius={0} style={{ width: '100%', height: 112, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} />
                {off ? <View style={[s.badge, { backgroundColor: ribbon }]}><Tx style={{ color: onRibbon, fontSize: 9.5, fontWeight: '900' }}>{off}% OFF</Tx></View> : null}
                {heart ? <View style={s.heart}><Ionicons name={hearted ? 'heart' : 'heart-outline'} size={15} color={hearted ? T.primary : '#444444'} /></View> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>{showDot ? <VegDot veg={d.veg} /> : null}<Tx numberOfLines={1} style={{ color: T.text, fontSize: 14, fontWeight: '800', flex: 1 }}>{d.name}</Tx></View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        {rated ? <View style={[s.rate, { marginTop: 0, marginRight: 8 }]}><Tx style={s.rateTxt}>{d.rating}</Tx><Ionicons name="star" size={8} color="#FFFFFF" style={{ marginLeft: 2 }} /></View> : null}
                        {C.features.prepTime !== false ? <Tx style={{ color: T.muted, fontSize: 10.5 }}>{d.mins} min</Tx> : null}
                    </View>
                    <Tx style={{ color: T.text, fontSize: 15, fontWeight: '800', marginTop: 4 }}>₹{d.price}{off ? <Tx style={{ color: T.muted, fontSize: 11, textDecorationLine: 'line-through', fontWeight: '500' }}>  ₹{d.mrp}</Tx> : null}</Tx>
                </View>
                <AddBtn />
            </View>
        </Pressable>
    );
}

function Tile({ d, onOpen }) {
    const { T } = useP();
    return (
        <Pressable onPress={onOpen} style={{ width: 118, marginRight: 8, borderRadius: 14, overflow: 'hidden', backgroundColor: T.surface, borderColor: T.border, borderWidth: HAIR }}>
            <Glow radius={14} />
            <Photo emoji={d.emoji} size={118} radius={0} style={{ height: 82 }} />
            <View style={{ padding: 8 }}>
                <Tx numberOfLines={1} style={{ color: T.text, fontSize: 11.5, fontWeight: '800' }}>{d.name}</Tx>
                <Tx style={{ color: T.text, fontSize: 12, fontWeight: '800', marginTop: 3 }}>₹{d.price}</Tx>
            </View>
            <View style={{ position: 'absolute', right: 6, top: 58 }}><AddBtn kind="circle" /></View>
        </Pressable>
    );
}

function Coupon({ o, width = 236, onPress }) {
    const { T } = useP();
    return (
        <Pressable onPress={onPress} style={{ width, height: 74, flexDirection: 'row', borderRadius: 14, backgroundColor: T.surface, borderColor: T.border, borderWidth: HAIR, marginRight: 8 }}>
            <Glow radius={14} />
            <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 66, alignItems: 'center', justifyContent: 'center', borderTopLeftRadius: 14, borderBottomLeftRadius: 14 }}>
                <Tx style={{ color: T.onPrimary, fontSize: 19, fontWeight: '900' }}>{o.value}</Tx>
                <Tx style={{ color: T.onPrimary, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }}>OFF</Tx>
            </LinearGradient>
            <View style={[s.notch, { top: -6, left: 60, backgroundColor: T.background }]} />
            <View style={[s.notch, { bottom: -6, left: 60, backgroundColor: T.background }]} />
            <View style={{ flex: 1, paddingLeft: 14, justifyContent: 'center' }}>
                <View style={{ alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: T.primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Tx style={{ color: T.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 }}>{o.code}</Tx>
                </View>
                <Tx numberOfLines={1} style={{ color: T.text, fontSize: 11, fontWeight: '700', marginTop: 6 }}>{o.desc}</Tx>
                <Tx style={{ color: T.muted, fontSize: 9.5, marginTop: 1 }}>Min order ₹{o.min}</Tx>
            </View>
        </Pressable>
    );
}

/* ============================== HOME ============================== */
function HomeHeader() {
    const { T, C, nav } = useP();
    const light = T.look !== 'bold';
    const compact = C.brand.headerStyle === 'compact';
    const fg = light ? T.text : T.onPrimary;
    const glass = light ? T.surface : 'rgba(255,255,255,0.18)';
    const line = light ? T.border : 'rgba(255,255,255,0.28)';
    const chips = [];
    if (C.features.prepTime !== false) chips.push(['time-outline', `${C.orders.prepTimeMin || 25} min`]);
    const fee = C.orders.deliveryFee || {};
    chips.push(['bicycle-outline', fee.type === 'flat' ? `₹${fee.amount || 0} delivery` : fee.type === 'free_above' ? `Free above ₹${fee.freeAbove || 0}` : 'Free delivery']);
    if (C.orders.minOrder > 0) chips.push(['bag-check-outline', `Min ₹${C.orders.minOrder}`]);
    const open = C.open && !nav.closed;
    return (
        <LinearGradient
            colors={light ? [T.wash, T.background] : [T.primaryLight, T.primaryDark]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: compact ? 12 : 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' }}
        >
            {light ? null : <View style={[s.blob, { top: -40, right: -30, width: 140, height: 140 }]} />}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable onPress={() => nav.sheet('address')} style={{ flex: 1 }}>
                    <Tx style={{ color: fg, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, opacity: 0.78 }}>DELIVER TO</Tx>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <Ionicons name="location-sharp" size={13} color={light ? T.primary : fg} />
                        <Tx numberOfLines={1} style={{ color: fg, fontSize: 12, fontWeight: '700', marginHorizontal: 3 }}>Home  Sector 12, Indore</Tx>
                        <Ionicons name="chevron-down" size={12} color={fg} />
                    </View>
                </Pressable>
                <Pressable onPress={() => nav.push('notifications')} style={[s.hIcon, { backgroundColor: glass, borderColor: line }]}>
                    <Ionicons name="notifications-outline" size={16} color={fg} />
                    <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: '#E5383B', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 8, fontWeight: '900' }}>2</Text></View>
                </Pressable>
                {C.offers.enabled ? (
                    <Pressable onPress={() => nav.push('offers')} style={[s.hIcon, { backgroundColor: glass, borderColor: line, marginLeft: 6 }]}>
                        <Ionicons name="pricetags-outline" size={16} color={fg} />
                    </Pressable>
                ) : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: compact ? 8 : 12 }}>
                {C.logo ? <Image source={{ uri: C.logo }} style={{ width: compact ? 28 : 38, height: compact ? 28 : 38, borderRadius: 10, marginRight: 10, backgroundColor: 'rgba(255,255,255,0.35)' }} /> : null}
                <Tx numberOfLines={1} style={{ flex: 1, color: fg, fontSize: compact ? 19 : 25, fontWeight: '900', letterSpacing: -0.6 }}>{C.name}</Tx>
            </View>
            {!compact ? <Tx numberOfLines={1} style={{ color: fg, fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>{C.tagline}</Tx> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: compact ? 8 : 12 }}>
                <View style={[s.hChip, { backgroundColor: glass, borderColor: line }]}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: open ? '#4ADE80' : '#FF6B6B', marginRight: 5 }} />
                    <Tx style={{ color: fg, fontSize: 10.5, fontWeight: '700' }}>{open ? 'Open now' : 'Closed'}</Tx>
                </View>
                {(compact ? chips.slice(0, 1) : chips).map(([ic, t]) => (
                    <View key={t} style={[s.hChip, { backgroundColor: glass, borderColor: line }]}>
                        <Ionicons name={ic} size={11} color={fg} />
                        <Tx style={{ color: fg, fontSize: 10.5, fontWeight: '700', marginLeft: 4 }}>{t}</Tx>
                    </View>
                ))}
            </View>
        </LinearGradient>
    );
}

function VegSwitch({ on, onPress }) {
    const { T } = useP();
    return (
        <Pressable onPress={onPress} style={{ marginLeft: 8 }}>
            <View style={{ width: 58, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: on ? '#0F8A3C' : T.border, backgroundColor: on ? '#0F8A3C' : T.surface, justifyContent: 'center' }}>
                <Tx style={{ position: 'absolute', left: on ? 9 : 26, color: on ? '#FFFFFF' : T.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 }}>VEG</Tx>
                <View style={{ position: 'absolute', left: on ? 30 : 2, top: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 11, height: 11, borderWidth: 1.5, borderColor: on ? '#0F8A3C' : '#8A8F98', borderRadius: 2, alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: on ? '#0F8A3C' : '#8A8F98' }} />
                    </View>
                </View>
            </View>
        </Pressable>
    );
}

function SearchBar({ veg, onVeg, onPress, query, onClear }) {
    const { T, C } = useP();
    const showVeg = C.features.vegToggle !== false && C.foodMode === 'mixed';
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: T.background }}>
            <Pressable onPress={onPress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: 13, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, paddingHorizontal: 11 }}>
                <Ionicons name="search" size={15} color={T.primary} />
                <Tx numberOfLines={1} style={{ flex: 1, marginLeft: 8, color: query ? T.text : T.muted, fontSize: 12, fontWeight: query ? '700' : '400' }}>{query || 'Search "Chicken Dum Biryani"'}</Tx>
                {query ? <Pressable onPress={onClear} hitSlop={8}><Ionicons name="close-circle" size={16} color={T.muted} /></Pressable> : <Ionicons name="mic-outline" size={16} color={T.muted} />}
            </Pressable>
            {showVeg ? <VegSwitch on={veg} onPress={onVeg} /> : null}
        </View>
    );
}

function Banner() {
    const { T } = useP();
    const b = BANNERS[0];
    return (
        <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
            <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 112, borderRadius: 20, padding: 16, justifyContent: 'center', overflow: 'hidden' }}>
                <View style={[s.blob, { top: -30, right: -20, width: 110, height: 110 }]} />
                <Tx style={{ color: T.onPrimary, fontSize: 19, fontWeight: '900', letterSpacing: -0.4, maxWidth: '72%' }}>{b.title}</Tx>
                <Tx style={{ color: T.onPrimary, fontSize: 11, opacity: 0.92, marginTop: 3, maxWidth: '72%' }}>{b.sub}</Tx>
                <View style={{ alignSelf: 'flex-start', marginTop: 9, backgroundColor: T.onPrimary, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 5, flexDirection: 'row', alignItems: 'center' }}>
                    <Tx style={{ color: onColor(T.onPrimary), fontSize: 10.5, fontWeight: '800' }}>Order now</Tx>
                    <Ionicons name="arrow-forward" size={10} color={onColor(T.onPrimary)} style={{ marginLeft: 3 }} />
                </View>
            </LinearGradient>
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6 }}>
                <View style={{ width: 16, height: 5, borderRadius: 3, backgroundColor: T.primary, marginRight: 4 }} />
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: T.border, marginRight: 4 }} />
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: T.border }} />
            </View>
        </View>
    );
}

function Cats({ sel, onPick }) {
    const { T, C } = useP();
    const style = C.brand.categoryStyle;
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' }}>
            {CATEGORIES.map((c) => {
                const on = sel === c.id;
                if (style === 'tiles') {
                    return (
                        <Pressable key={c.id} onPress={() => onPick(c.id)} style={{ marginRight: 8 }}>
                            <View style={{ width: 68, height: 80, borderRadius: 16, borderWidth: 2, borderColor: on ? T.primary : 'transparent', backgroundColor: T.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                <Text style={{ fontSize: 30 }}>{c.emoji}</Text>
                                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 4, backgroundColor: 'rgba(0,0,0,0.45)' }}>
                                    <Tx style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', textAlign: 'center' }}>{c.name}</Tx>
                                </View>
                                {on ? <View style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={10} color={T.onPrimary} /></View> : null}
                            </View>
                        </Pressable>
                    );
                }
                if (style === 'pills') {
                    return (
                        <Pressable key={c.id} onPress={() => onPick(c.id)} style={{ flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, borderWidth: 1, borderColor: on ? T.primary : T.border, backgroundColor: on ? T.primary : T.surface, paddingLeft: 4, paddingRight: 12, marginRight: 8 }}>
                            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.soft, alignItems: 'center', justifyContent: 'center', marginRight: 6 }}><Text style={{ fontSize: 14 }}>{c.emoji}</Text></View>
                            <Tx style={{ color: on ? T.onPrimary : T.text, fontSize: 11.5, fontWeight: '700' }}>{c.name}</Tx>
                        </Pressable>
                    );
                }
                return (
                    <Pressable key={c.id} onPress={() => onPick(c.id)} style={{ alignItems: 'center', width: 64, marginRight: 4 }}>
                        <View style={{ width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: on ? T.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                            <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: T.soft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24 }}>{c.emoji}</Text></View>
                        </View>
                        <Tx style={{ color: on ? T.primary : T.text, fontSize: 10.5, fontWeight: '700', marginTop: 3 }}>{c.name}</Tx>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

function Chip({ label, on, icon, onPress }) {
    const { T } = useP();
    return (
        <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: on ? T.primary : T.border, backgroundColor: on ? T.primary : T.surface, marginRight: 7 }}>
            {icon ? <Ionicons name={icon} size={12} color={on ? T.onPrimary : T.text} style={{ marginRight: 4 }} /> : null}
            <Tx style={{ color: on ? T.onPrimary : T.text, fontSize: 11, fontWeight: '700' }}>{label}</Tx>
            {on && !icon ? <Ionicons name="close" size={11} color={T.onPrimary} style={{ marginLeft: 4 }} /> : null}
        </Pressable>
    );
}

// The shop's address, with a Directions button when the shop is pinned on the map. Off when the switch is off.
function StorePlace() {
    const { T, C } = useP();
    const [hint, setHint] = useState(false);
    if (!C.directions || (!C.address && !C.pinned)) return null;
    const style = C.brand.locationStyle;
    const go = () => { setHint(true); setTimeout(() => setHint(false), 2200); };
    const note = hint ? <Tx style={{ color: T.muted, fontSize: 9.5, marginHorizontal: 14, marginTop: 4 }}>On a customer's phone this opens Google Maps with directions to the shop.</Tx> : null;

    if (style === 'chip') {
        return (
            <View>
                <View style={{ marginHorizontal: 14, marginTop: 12, flexDirection: 'row' }}>
                    <Pressable onPress={C.pinned ? go : undefined} style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '100%', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 99, borderWidth: HAIR, borderColor: T.border, backgroundColor: T.surface }}>
                        <Ionicons name="location-sharp" size={13} color={T.primary} />
                        <Tx numberOfLines={1} style={{ flexShrink: 1, color: T.text, fontSize: 11, fontWeight: '700', marginLeft: 5 }}>{C.address || 'On the map'}</Tx>
                        {C.pinned ? (
                            <>
                                <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: T.muted, marginHorizontal: 7 }} />
                                <Ionicons name="navigate" size={13} color={T.primary} />
                            </>
                        ) : null}
                    </Pressable>
                </View>
                {note}
            </View>
        );
    }
    if (style === 'list') {
        return (
            <View>
                <Pressable onPress={C.pinned ? go : undefined} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: HAIR, borderBottomWidth: HAIR, borderColor: T.border }}>
                    <Ionicons name={C.pinned ? 'storefront-outline' : 'location-outline'} size={18} color={T.primary} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Tx numberOfLines={2} style={{ color: T.text, fontSize: 11.5, fontWeight: '700' }}>{C.address || 'On the map'}</Tx>
                        {C.pinned ? <Tx style={{ color: T.primary, fontSize: 10.5, fontWeight: '800', marginTop: 1 }}>Tap the arrow for directions</Tx> : null}
                    </View>
                    {C.pinned ? <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}><Ionicons name="navigate" size={15} color={T.onPrimary} /></View> : null}
                </Pressable>
                {note}
            </View>
        );
    }
    if (style === 'banner') {
        return (
            <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: alpha(T.primary, 0.1), borderTopWidth: HAIR, borderBottomWidth: HAIR, borderColor: alpha(T.primary, 0.2) }}>
                    <Ionicons name="location-sharp" size={16} color={T.primary} />
                    <Tx numberOfLines={2} style={{ flex: 1, color: T.text, fontSize: 11.5, fontWeight: '700', marginLeft: 7 }}>{C.address || 'On the map'}</Tx>
                    {C.pinned ? (
                        <Pressable onPress={go} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
                            <Ionicons name="navigate" size={15} color={T.onPrimary} />
                        </Pressable>
                    ) : null}
                </View>
                {note}
            </View>
        );
    }
    return (
        <View style={{ marginHorizontal: 14, marginTop: 12, padding: 12, borderRadius: 16, borderWidth: HAIR, borderColor: T.border, backgroundColor: T.surface }}>
            <Glow radius={16} />
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={C.pinned ? 'storefront-outline' : 'location-outline'} size={18} color={T.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Tx style={{ color: T.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>{C.pinned ? 'VISIT US' : 'FIND US'}</Tx>
                    <Tx numberOfLines={2} style={{ color: T.text, fontSize: 11.5, fontWeight: '700', marginTop: 1 }}>{C.address || 'On the map'}</Tx>
                </View>
                {C.pinned ? (
                    <Pressable onPress={go} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
                        <Ionicons name="navigate" size={15} color={T.onPrimary} />
                    </Pressable>
                ) : null}
            </View>
            {hint ? <Tx style={{ color: T.muted, fontSize: 9.5, marginTop: 6 }}>On a customer's phone this opens Google Maps with directions to the shop.</Tx> : null}
        </View>
    );
}

function HomeScreen() {
    const { T, C, nav } = useP();
    const [veg, setVeg] = useState(false);
    const [cat, setCat] = useState(null);
    const [quick, setQuick] = useState({});
    const flip = (k) => setQuick((q) => ({ ...q, [k]: !q[k] }));

    let dishes = DISHES.slice();
    if (veg) dishes = dishes.filter((d) => d.veg);
    if (cat) dishes = dishes.filter((d) => d.cat === cat);
    if (quick.best) dishes = dishes.filter((d) => d.best);
    if (quick.rate) dishes = dishes.filter((d) => d.rating >= 4.5);
    if (quick.offer) dishes = dishes.filter((d) => d.mrp > d.price);
    if (quick.low) dishes = dishes.slice().sort((a, b) => a.price - b.price);
    const bests = DISHES.filter((d) => d.best && (!veg || d.veg));
    const open = (d) => nav.push('item', { d });

    const body = [];
    if (nav.closed) {
        body.push(
            <View key="closed" style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: T.errorSoft, marginHorizontal: 14, marginTop: 10, borderRadius: 12, padding: 10 }}>
                <Ionicons name="moon-outline" size={15} color={T.errorText} />
                <Tx style={{ color: T.errorText, fontWeight: '700', fontSize: 11, marginLeft: 8, flex: 1 }}>{C.labels.closed}</Tx>
            </View>,
        );
    }
    C.blocks.forEach((b) => {
        if (b === 'search') body.push(<SearchBar key="search" veg={veg} onVeg={() => setVeg((v) => !v)} onPress={() => nav.tab('search')} />);
        else if (b === 'banner') body.push(<Banner key="banner" />);
        else if (b === 'categories') body.push(<Cats key="cats" sel={cat} onPick={(id) => setCat(cat === id ? null : id)} />);
        else if (b === 'filters') {
            body.push(
                <ScrollView key="filters" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 6 }}>
                    <Chip label="Filters" icon="options-outline" onPress={() => nav.sheet('filters')} />
                    <Chip label="Price: low" on={!!quick.low} onPress={() => flip('low')} />
                    <Chip label="Bestseller" on={!!quick.best} onPress={() => flip('best')} />
                    <Chip label="Rating 4+" on={!!quick.rate} onPress={() => flip('rate')} />
                    <Chip label="Offers" on={!!quick.offer} onPress={() => flip('offer')} />
                </ScrollView>,
            );
        } else if (b === 'offers' && C.offers.enabled && C.offers.onHome) {
            body.push(
                <View key="offers">
                    <SecHead title="Offers for you" onSee={() => nav.push('offers')} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                        {OFFERS.map((o) => <Coupon key={o.code} o={o} onPress={() => nav.push('offers')} />)}
                    </ScrollView>
                </View>,
            );
        } else if (['bestsellers', 'festival', 'combos', 'new_arrivals'].includes(b)) {
            const list = b === 'bestsellers' ? bests : DISHES.slice(b === 'combos' ? 2 : b === 'festival' ? 4 : 5).filter((d) => !veg || d.veg);
            if (!list.length) return;
            const t = { bestsellers: ['Bestsellers', 'Most ordered'], festival: ['Festival specials', 'Made for the season'], combos: ['Combos', 'Better together'], new_arrivals: ['New arrivals', 'Just added'] }[b];
            body.push(
                <View key={b}>
                    <SecHead title={t[0]} sub={t[1]} onSee={b === 'bestsellers' ? () => nav.push('bestsellers') : undefined} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                        {list.map((d) => <Tile key={d.id} d={d} onOpen={() => open(d)} />)}
                    </ScrollView>
                </View>,
            );
        } else if (b === 'items') {
            if (!dishes.length) {
                body.push(<Tx key="empty" style={{ color: T.muted, textAlign: 'center', padding: 30, fontSize: 12 }}>No dishes found</Tx>);
                return;
            }
            const groups = C.grouped && !cat
                ? CATEGORIES.map((c) => ({ title: c.name, list: dishes.filter((d) => d.cat === c.id) })).filter((g) => g.list.length)
                : [{ title: cat ? CATEGORIES.find((c) => c.id === cat)?.name : 'Full menu', list: dishes }];
            groups.forEach((g) => {
                body.push(<SecHead key={`h-${g.title}`} title={g.title} sub={`${g.list.length} dish${g.list.length > 1 ? 'es' : ''}`} />);
                if (C.cardStyle === 'grid') {
                    for (let i = 0; i < g.list.length; i += 2) {
                        body.push(
                            <View key={`p-${g.title}-${i}`} style={{ flexDirection: 'row', paddingHorizontal: 8 }}>
                                <View style={{ flex: 1 }}><DishCard d={g.list[i]} variant="grid" onOpen={() => open(g.list[i])} /></View>
                                <View style={{ flex: 1 }}>{g.list[i + 1] ? <DishCard d={g.list[i + 1]} variant="grid" onOpen={() => open(g.list[i + 1])} /> : null}</View>
                            </View>,
                        );
                    }
                } else g.list.forEach((d) => body.push(<DishCard key={`d-${d.id}`} d={d} variant={C.cardStyle} onOpen={() => open(d)} />));
            });
        }
    });

    return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }} style={{ backgroundColor: T.background }}>
            <HomeHeader />
            <StorePlace />
            {body}
        </ScrollView>
    );
}

/* ============================== SEARCH ============================== */
function SearchScreen() {
    const { T, nav } = useP();
    const q = (nav.q || '').trim().toLowerCase();
    const results = q ? DISHES.filter((d) => d.name.toLowerCase().includes(q) || d.cat.includes(q)) : [];
    return (
        <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: T.background }} contentContainerStyle={{ paddingBottom: 90 }}>
            <SearchBar veg={false} onVeg={() => { }} query={nav.q} onClear={() => nav.setQ('')} onPress={() => nav.setQ(nav.q ? '' : 'biryani')} />
            {q ? (
                <>
                    <Tx style={{ color: T.muted, fontSize: 11, paddingHorizontal: 14, paddingBottom: 6 }}>{results.length} result{results.length === 1 ? '' : 's'} for "{nav.q}"</Tx>
                    {results.map((d) => <DishCard key={d.id} d={d} variant="compact" onOpen={() => nav.push('item', { d })} />)}
                    {!results.length ? (
                        <View style={{ alignItems: 'center', padding: 30 }}>
                            <View style={{ width: 66, height: 66, borderRadius: 33, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="search-outline" size={28} color={T.muted} /></View>
                            <Tx style={{ color: T.text, fontSize: 13, fontWeight: '800', marginTop: 10 }}>No dishes found</Tx>
                        </View>
                    ) : null}
                </>
            ) : (
                <>
                    <Cats sel={null} onPick={(id) => nav.setQ(id)} />
                    <SecHead title="Recent searches" />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14 }}>
                        {['biryani', 'coffee', 'pizza'].map((r) => (
                            <Pressable key={r} onPress={() => nav.setQ(r)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6, marginBottom: 6 }}>
                                <Ionicons name="time-outline" size={12} color={T.muted} />
                                <Tx style={{ color: T.text, fontSize: 11, fontWeight: '700', marginHorizontal: 5 }}>{r}</Tx>
                                <Ionicons name="close" size={11} color={T.muted} />
                            </Pressable>
                        ))}
                    </View>
                    <SecHead title="Popular right now" />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14 }}>
                        {DISHES.slice(0, 6).map((d, i) => (
                            <Pressable key={d.id} onPress={() => nav.push('item', { d })} style={{ width: '48%', marginRight: i % 2 === 0 ? '4%' : 0, marginBottom: 14 }}>
                                <Photo emoji={d.emoji} size={140} radius={14} style={{ width: '100%', height: 90 }} />
                                <View style={{ alignSelf: 'center', marginTop: -12 }}><AddBtn kind="outline" /></View>
                                <Tx numberOfLines={1} style={{ color: T.text, fontSize: 11.5, fontWeight: '800', marginTop: 6 }}>{d.name}</Tx>
                                <Tx style={{ color: T.text, fontSize: 12, fontWeight: '800' }}>₹{d.price}</Tx>
                            </Pressable>
                        ))}
                    </View>
                </>
            )}
        </ScrollView>
    );
}

/* ============================== CART ============================== */
function CartScreen() {
    const { T, C, nav } = useP();
    if (nav.emptyCart) {
        return (
            <View style={{ flex: 1, backgroundColor: T.background }}>
                <View style={{ alignItems: 'center', paddingTop: 26, paddingBottom: 16 }}>
                    <View style={{ width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="cart-outline" size={38} color={T.muted} /></View>
                    <Tx style={{ color: T.text, fontSize: 15, fontWeight: '800', marginTop: 12 }}>{C.labels.emptyCart}</Tx>
                    <Tx style={{ color: T.muted, fontSize: 11, marginTop: 3 }}>Good food is always cooking.</Tx>
                    <Btn title="Browse Menu" onPress={() => nav.tab('home')} style={{ marginTop: 14, paddingHorizontal: 26 }} />
                </View>
                {C.features.favourites ? (
                    <ScrollView showsVerticalScrollIndicator={false}>
                        <SecHead title="Order from your favourites" sub="Dishes you saved, one tap to add" />
                        {DISHES.slice(0, 3).map((d) => <DishCard key={d.id} d={d} variant="compact" hearted onOpen={() => nav.push('item', { d })} />)}
                    </ScrollView>
                ) : null}
            </View>
        );
    }
    const lines = [{ d: DISHES[0], q: 2 }, { d: DISHES[7], q: 1 }];
    const sub = lines.reduce((a, l) => a + l.d.price * l.q, 0);
    const fee = C.orders.deliveryFee || {};
    const delivery = fee.type === 'flat' ? fee.amount || 0 : fee.type === 'free_above' ? (sub >= (fee.freeAbove || 0) ? 0 : fee.amount || 0) : 0;
    const total = sub + delivery;
    const closed = nav.closed || !C.open;
    return (
        <View style={{ flex: 1, backgroundColor: T.background }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
                <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
                    <Tx style={{ color: T.text, fontSize: 19, fontWeight: '900' }}>{C.name}</Tx>
                    <Tx style={{ color: T.muted, fontSize: 11 }}>Your cart · 3 items</Tx>
                </View>
                {closed ? (
                    <View style={{ marginHorizontal: 14, marginTop: 10, borderRadius: 12, borderWidth: 1, borderColor: T.errorText, backgroundColor: T.errorSoft, padding: 10, flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="time-outline" size={16} color={T.errorText} />
                        <View style={{ flex: 1, marginLeft: 8 }}>
                            <Tx style={{ color: T.errorText, fontSize: 11.5, fontWeight: '800' }}>Shop is closed</Tx>
                            <Tx style={{ color: T.errorText, fontSize: 10 }}>{C.labels.closed}. You cannot place orders right now.</Tx>
                        </View>
                    </View>
                ) : null}
                {fee.type === 'free_above' && fee.freeAbove > 0 ? (
                    <View style={{ marginHorizontal: 14, marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: sub >= fee.freeAbove ? alpha(T.ok, 0.14) : alpha(T.primary, 0.12) }}>
                        <Tx style={{ color: sub >= fee.freeAbove ? T.ok : T.primary, fontSize: 11, fontWeight: '600', textAlign: 'center' }}>
                            {sub >= fee.freeAbove ? 'Yay! You unlocked FREE Delivery 🚲' : `Add ₹${fee.freeAbove - sub} more to get FREE Delivery 🚲`}
                        </Tx>
                        <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)', marginTop: 7, overflow: 'hidden' }}>
                            <View style={{ width: `${Math.min(100, (sub / fee.freeAbove) * 100)}%`, height: 4, backgroundColor: sub >= fee.freeAbove ? T.ok : T.primary }} />
                        </View>
                    </View>
                ) : null}
                <Card>
                    {lines.map((l, i) => (
                        <View key={l.d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: i < lines.length - 1 ? HAIR : 0, borderBottomColor: T.border }}>
                            <Photo emoji={l.d.emoji} size={40} radius={10} />
                            <Tx numberOfLines={2} style={{ flex: 1, marginHorizontal: 10, color: T.text, fontSize: 12, fontWeight: '800' }}>{l.d.name}</Tx>
                            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: alpha(T.primary, 0.12), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }}>
                                <Tx style={{ color: T.primary, fontSize: 14, fontWeight: '800' }}>−</Tx>
                                <Tx style={{ color: T.primary, fontSize: 12, fontWeight: '900', marginHorizontal: 8 }}>{l.q}</Tx>
                                <Tx style={{ color: T.primary, fontSize: 14, fontWeight: '800' }}>+</Tx>
                            </View>
                            <Tx style={{ color: T.text, fontSize: 12, fontWeight: '800', marginLeft: 10, minWidth: 40, textAlign: 'right' }}>₹{l.d.price * l.q}</Tx>
                        </View>
                    ))}
                </Card>
                {C.features.favourites ? (
                    <View style={{ marginTop: 14 }}>
                        <SecHead title="Add from your favourites" sub="Saved dishes that go well with this order" />
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                            {DISHES.slice(2, 6).map((d) => <Tile key={d.id} d={d} onOpen={() => nav.push('item', { d })} />)}
                        </ScrollView>
                    </View>
                ) : null}
                {C.features.couponField !== false && C.offers.enabled ? (
                    <View style={{ marginTop: 12 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14 }}>
                            {OFFERS.slice(0, 2).map((o) => <Coupon key={o.code} o={o} width={200} />)}
                        </ScrollView>
                    </View>
                ) : null}
                <Card>
                    {[['Item total', `₹${sub}`], ['Delivery fee', delivery ? `₹${delivery}` : 'FREE']].map(([k, v]) => (
                        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                            <Tx style={{ color: T.muted, fontSize: 11.5 }}>{k}</Tx>
                            <Tx style={{ color: v === 'FREE' ? T.ok : T.text, fontSize: 11.5, fontWeight: '700' }}>{v}</Tx>
                        </View>
                    ))}
                    <View style={{ height: HAIR, backgroundColor: T.border, marginVertical: 6 }} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>Grand total</Tx>
                        <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>₹{total}</Tx>
                    </View>
                </Card>
            </ScrollView>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: T.surface, borderTopWidth: HAIR, borderTopColor: T.border }}>
                <Pressable onPress={() => nav.push('payment')} style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 8 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="wallet-outline" size={16} color={T.primary} /></View>
                    <View style={{ marginLeft: 8 }}>
                        <Tx style={{ color: T.text, fontSize: 11.5, fontWeight: '800' }}>{/^cash on delivery$/i.test(nav.pay) ? 'COD' : nav.pay}</Tx>
                        <Tx style={{ color: T.muted, fontSize: 9.5 }}>Click to change</Tx>
                    </View>
                </Pressable>
                <Pressable onPress={closed ? undefined : () => nav.replaceWith('placed')} style={{ height: 46, borderRadius: T.radius, backgroundColor: closed ? T.muted : T.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Tx style={{ color: T.onPrimary, fontSize: 10, opacity: 0.9 }}>{closed ? ' ' : `₹${total}`}</Tx>
                    <Tx style={{ color: T.onPrimary, fontSize: 12.5, fontWeight: '900' }}>{closed ? 'Shop closed' : C.labels.orderButton}</Tx>
                </Pressable>
            </View>
        </View>
    );
}

/* ============================== ORDERS ============================== */
function OrdersScreen() {
    const { T, nav } = useP();
    const live = ORDERS.live;
    return (
        <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: T.background }} contentContainerStyle={{ paddingBottom: 90 }}>
            <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
                <Tx style={{ color: T.text, fontSize: 21, fontWeight: '900', letterSpacing: -0.4 }}>Your orders</Tx>
                <Tx style={{ color: T.primary, fontSize: 11, fontWeight: '700', marginTop: 1 }}>1 active right now</Tx>
            </View>
            <Tx style={{ color: T.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>LIVE NOW</Tx>
            <Pressable onPress={() => nav.push('orderDetail', { delivered: false })} style={{ marginHorizontal: 14, borderRadius: 20, overflow: 'hidden' }}>
                <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16 }}>
                    <View style={[s.blob, { top: -40, right: -20, width: 120, height: 120 }]} />
                    <Tx style={{ color: T.onPrimary, fontSize: 9.5, fontWeight: '900', letterSpacing: 1, opacity: 0.9 }}>● LIVE · ORDER #{live.no}</Tx>
                    <Tx style={{ color: T.onPrimary, fontSize: 21, fontWeight: '900', letterSpacing: -0.4, marginTop: 6 }}>{STEPS[live.step]}</Tx>
                    <Tx style={{ color: T.onPrimary, fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>Ready in about {live.eta} min</Tx>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)', marginTop: 14, overflow: 'hidden' }}>
                        <View style={{ width: `${((live.step + 1) / STEPS.length) * 100}%`, height: 5, backgroundColor: '#FFFFFF' }} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                        <Tx numberOfLines={1} style={{ flex: 1, color: T.onPrimary, fontSize: 11, opacity: 0.92 }}>{live.items}</Tx>
                        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7 }}><Tx style={{ color: T.primary, fontSize: 11.5, fontWeight: '900' }}>Track</Tx></View>
                    </View>
                </LinearGradient>
            </Pressable>
            <Tx style={{ color: T.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>EARLIER</Tx>
            {ORDERS.past.map((o) => (
                <Pressable key={o.no} onPress={() => nav.push('orderDetail', { delivered: true })} style={{ marginHorizontal: 14, marginBottom: 10, borderRadius: 16, borderWidth: HAIR, borderColor: T.border, backgroundColor: T.surface, padding: 12, flexDirection: 'row' }}>
                    <Glow radius={16} />
                    <View style={{ width: 3, borderRadius: 2, backgroundColor: T.ok, marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '900' }}>Order #{o.no}</Tx>
                            <Tx style={{ color: T.ok, fontSize: 10.5, fontWeight: '800' }}>{o.status}</Tx>
                        </View>
                        <Tx style={{ color: T.muted, fontSize: 10, marginTop: 1 }}>{o.date}</Tx>
                        <Tx numberOfLines={1} style={{ color: T.muted, fontSize: 11, marginTop: 6 }}>{o.items}</Tx>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                            <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>₹{o.total}</Tx>
                            <View style={{ backgroundColor: T.primary, borderRadius: T.radius, paddingHorizontal: 14, paddingVertical: 6 }}><Tx style={{ color: T.onPrimary, fontSize: 11, fontWeight: '800' }}>Reorder</Tx></View>
                        </View>
                    </View>
                </Pressable>
            ))}
        </ScrollView>
    );
}

/* ============================== OFFERS / FAVOURITES / BESTSELLERS / NOTIFICATIONS ============================== */
function OffersList() {
    return (
        <View style={{ padding: 14 }}>
            {OFFERS.map((o) => <View key={o.code} style={{ marginBottom: 10 }}><Coupon o={o} width={292} /></View>)}
        </View>
    );
}
function OffersPage() {
    return <Page title="Offers"><OffersList /></Page>;
}
function OffersTab() {
    const { T } = useP();
    return (
        <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: T.background }} contentContainerStyle={{ paddingBottom: 90 }}>
            <Tx style={{ color: T.text, fontSize: 21, fontWeight: '900', letterSpacing: -0.4, paddingHorizontal: 14, paddingTop: 12 }}>Offers</Tx>
            <OffersList />
        </ScrollView>
    );
}

function FavouritesPage() {
    const { T, C, nav } = useP();
    return (
        <Page title="Favourites">
            {!C.features.favourites ? (
                <View style={{ margin: 14, padding: 10, borderRadius: 12, backgroundColor: T.errorSoft }}>
                    <Tx style={{ color: T.errorText, fontSize: 10.5, fontWeight: '700' }}>Favourites are switched off for this shop. Customers will see "Favourites are not available". Turn them on under Features.</Tx>
                </View>
            ) : null}
            <View style={{ paddingTop: 8 }}>
                {DISHES.filter((d) => d.best || d.id < 3).slice(0, 4).map((d) => <DishCard key={d.id} d={d} variant="compact" hearted onOpen={() => nav.push('item', { d })} />)}
            </View>
        </Page>
    );
}

function BestsellersPage() {
    const { T, C, nav } = useP();
    return (
        <Page title="Bestsellers">
            <Tx style={{ color: T.muted, fontSize: 11, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 }}>Most ordered at {C.name}</Tx>
            {DISHES.filter((d) => d.best).map((d) => <DishCard key={d.id} d={d} variant="compact" onOpen={() => nav.push('item', { d })} />)}
        </Page>
    );
}

function NotificationsPage() {
    const { T } = useP();
    const rows = [
        ['receipt-outline', 'Your order is being prepared', 'Order #2481 · the kitchen has started', '2 min ago', true],
        ['pricetags-outline', 'WELCOME50 is waiting', '50% off your next order, up to ₹100', '1 h ago', true],
        ['checkmark-done-outline', 'Order delivered', 'Order #2476 · enjoy your meal!', 'Yesterday', false],
        ['gift-outline', 'Weekend feast', 'Flat 20% off on all biryanis', '2 days ago', false],
    ];
    return (
        <Page title="Notifications">
            {rows.map(([ic, title, sub, time, unread]) => (
                <View key={title} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: HAIR, borderBottomColor: T.border, backgroundColor: unread ? alpha(T.primary, 0.06) : 'transparent' }}>
                    <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={18} color={T.primary} /></View>
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: unread ? '800' : '600' }}>{title}</Tx>
                        <Tx style={{ color: T.muted, fontSize: 10.5, marginTop: 1 }}>{sub}</Tx>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <Tx style={{ color: T.muted, fontSize: 9.5 }}>{time}</Tx>
                        {unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.primary, marginTop: 6 }} /> : null}
                    </View>
                </View>
            ))}
        </Page>
    );
}

/* ============================== ACCOUNT ============================== */
function AccountScreen() {
    const { T, C, nav } = useP();
    const tiles = [
        ['receipt-outline', 'Orders', 'Track and reorder', () => nav.tab('orders')],
        ['location-outline', 'Addresses', 'Where we deliver', () => nav.sheet('address')],
        C.features.favourites
            ? ['heart-outline', 'Favourites', 'Dishes you love', () => nav.push('favourites')]
            : ['pricetags-outline', 'Offers', 'Coupons for you', () => nav.push('offers')],
        ['notifications-outline', 'Notifications', '2 unread', () => nav.push('notifications')],
    ];
    return (
        <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: T.background }} contentContainerStyle={{ paddingBottom: 90 }}>
            <Tx style={{ color: T.text, fontSize: 21, fontWeight: '900', letterSpacing: -0.4, paddingHorizontal: 14, paddingTop: 12 }}>Account</Tx>
            <View style={{ marginHorizontal: 14, marginTop: 10, borderRadius: 22, overflow: 'hidden' }}>
                <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, flexDirection: 'row', alignItems: 'center' }}>
                    <View style={[s.blob, { top: -40, right: -20, width: 120, height: 120 }]} />
                    <View style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                        <Tx style={{ color: T.onPrimary, fontSize: 20, fontWeight: '800' }}>A</Tx>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Tx style={{ color: T.onPrimary, fontSize: 16, fontWeight: '900' }}>{USER.name}</Tx>
                        <Tx style={{ color: T.onPrimary, fontSize: 10.5, opacity: 0.88, marginTop: 1 }}>{USER.phone}</Tx>
                    </View>
                    <Pressable onPress={() => nav.sheet('edit')} style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}><Tx style={{ color: T.onPrimary, fontSize: 11, fontWeight: '800' }}>Edit</Tx></Pressable>
                </LinearGradient>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginHorizontal: 14, marginTop: 12 }}>
                {tiles.map(([ic, label, sub, go]) => (
                    <Pressable key={label} onPress={go} style={{ width: '48.5%', marginBottom: 10, borderRadius: 16, borderWidth: HAIR, borderColor: T.border, backgroundColor: T.surface, padding: 12 }}>
                        <Glow radius={16} />
                        <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={19} color={T.primary} /></View>
                        <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900', marginTop: 10 }}>{label}</Tx>
                        <Tx style={{ color: T.muted, fontSize: 10 }}>{sub}</Tx>
                    </Pressable>
                ))}
            </View>
            <Card style={{ marginTop: 4 }}>
                <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '800' }}>Appearance</Tx>
                <View style={{ flexDirection: 'row', marginTop: 8, borderRadius: 11, borderWidth: 1, borderColor: T.border, backgroundColor: T.background, padding: 3 }}>
                    {['System', 'Light', 'Dark'].map((m, i) => (
                        <View key={m} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8, backgroundColor: i === 0 ? T.primary : 'transparent' }}>
                            <Tx style={{ color: i === 0 ? T.onPrimary : T.muted, fontSize: 11, fontWeight: '800' }}>{m}</Tx>
                        </View>
                    ))}
                </View>
            </Card>
            <Card>
                {[['call-outline', `Contact ${C.name}`, false], ['log-out-outline', 'Log out', false], ['trash-outline', 'Delete account', true]].map(([ic, label, danger], i, a) => (
                    <Pressable key={label} onPress={label === 'Log out' ? () => nav.reset(['login']) : undefined} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < a.length - 1 ? HAIR : 0, borderBottomColor: T.border }}>
                        <Ionicons name={ic} size={17} color={danger ? T.errorText : T.primary} />
                        <Tx style={{ flex: 1, marginLeft: 10, color: danger ? T.errorText : T.text, fontSize: 12.5, fontWeight: '700' }}>{label}</Tx>
                        <Ionicons name="chevron-forward" size={15} color={T.muted} />
                    </Pressable>
                ))}
            </Card>
        </ScrollView>
    );
}

/* ============================== ITEM PAGE ============================== */
function ItemPage({ d }) {
    const { T, C, nav } = useP();
    const o = C.itemOptions || {};
    const [size, setSize] = useState(0);
    const group = (title, req, children) => (
        <View style={{ marginTop: 14, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, borderRadius: 14, padding: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>{title}</Tx>
                {req ? <View style={{ backgroundColor: alpha(T.primary, 0.12), borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}><Tx style={{ color: T.primary, fontSize: 9, fontWeight: '900' }}>REQUIRED</Tx></View> : null}
            </View>
            {children}
        </View>
    );
    const row = (label, price, on, radio, onPress) => (
        <Pressable key={label} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
            <View style={{ width: 18, height: 18, borderRadius: radio ? 9 : 5, borderWidth: 2, borderColor: on ? T.primary : '#BBBBBB', backgroundColor: !radio && on ? T.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {radio && on ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.primary }} /> : null}
                {!radio && on ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
            </View>
            <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: on ? '800' : '600', marginLeft: 10, flex: 1 }}>{label}</Tx>
            {price ? <Tx style={{ color: T.muted, fontSize: 11.5, fontWeight: '700' }}>+₹{price}</Tx> : null}
        </Pressable>
    );
    return (
        <View style={{ flex: 1, backgroundColor: T.background }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
                <Photo emoji={d.emoji} size={320} radius={0} style={{ width: '100%', height: 220 }} />
                <View style={{ marginTop: -22, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: T.background, padding: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}><VegDot veg={d.veg} /><Tx style={{ color: T.text, fontSize: 19, fontWeight: '900', flex: 1 }}>{d.name}</Tx></View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                        {C.features.ratingBadge !== false ? <View style={[s.rate, { marginTop: 0, marginRight: 8 }]}><Tx style={s.rateTxt}>{d.rating}</Tx><Ionicons name="star" size={8} color="#FFFFFF" style={{ marginLeft: 2 }} /></View> : null}
                        {C.features.prepTime !== false ? <Tx style={{ color: T.muted, fontSize: 11 }}>{d.mins} min</Tx> : null}
                    </View>
                    <Tx style={{ color: T.text, fontSize: 19, fontWeight: '900', marginTop: 8 }}>₹{d.price}</Tx>
                    <Tx style={{ color: T.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }}>{d.desc}</Tx>
                    {o.sizes ? group('Choose size', true, ['Regular', 'Large'].map((l, i) => row(l, i * 40, size === i, true, () => setSize(i)))) : null}
                    {o.addOns ? group('Add-ons', false, [['Extra cheese', 30], ['Raita', 20], ['Salad', 15]].map(([l, p], i) => row(l, p, i === 0, false))) : null}
                    {o.spiceLevel ? group('Spice level', false, ['Mild', 'Medium', 'Hot'].map((l, i) => row(l, 0, i === 1, true))) : null}
                    {o.weightOptions ? group('Weight', false, ['250 g', '500 g', '1 kg'].map((l, i) => row(l, i * 80, i === 1, true))) : null}
                </View>
            </ScrollView>
            <Pressable onPress={nav.pop} style={{ position: 'absolute', top: 12, left: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="arrow-back" size={18} color="#1C1C1C" />
            </Pressable>
            {C.features.favourites ? (
                <View style={{ position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="heart-outline" size={18} color="#1C1C1C" />
                </View>
            ) : null}
            <Dock>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: T.primary, backgroundColor: alpha(T.primary, 0.12), borderRadius: T.radius, paddingHorizontal: 12, height: 44, marginRight: 10 }}>
                    <Tx style={{ color: T.primary, fontSize: 16, fontWeight: '800' }}>−</Tx>
                    <Tx style={{ color: T.primary, fontSize: 13, fontWeight: '900', marginHorizontal: 10 }}>1</Tx>
                    <Tx style={{ color: T.primary, fontSize: 16, fontWeight: '800' }}>+</Tx>
                </View>
                <Pressable onPress={() => nav.tab('cart')} style={{ flex: 1, height: 44, borderRadius: T.radius, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Tx style={{ color: T.onPrimary, fontSize: 13, fontWeight: '900' }}>{C.labels.addButton} · ₹{d.price + size * 40}</Tx>
                </Pressable>
            </Dock>
        </View>
    );
}

/* ============================== PAYMENT OPTIONS, CARD DETAILS ============================== */
function PaymentPage() {
    const { T, C, nav } = useP();
    const online = (C.orders.payments || ['cod']).some((p) => p !== 'cod');
    const [pick, setPick] = useState(nav.pay);
    const choose = (label, card) => {
        if (card) { nav.push('card'); return; }
        setPick(label);
        nav.setPay(label);
        setTimeout(nav.pop, 260);
    };
    const row = (label, desc, icon, mark, color, card) => (
        <Pressable key={label} onPress={() => choose(label, card)} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderWidth: 1.5, borderRadius: 14, marginBottom: 10, borderColor: pick === label ? T.primary : T.border, backgroundColor: pick === label ? alpha(T.primary, 0.08) : T.surface }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: mark ? color : alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                {mark ? <Tx style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '900' }}>{mark}</Tx> : <Ionicons name={icon} size={19} color={T.primary} />}
            </View>
            <View style={{ flex: 1, marginHorizontal: 10 }}>
                <Tx style={{ color: T.text, fontSize: 13, fontWeight: '800' }}>{label}</Tx>
                <Tx style={{ color: T.muted, fontSize: 10.5, marginTop: 1 }}>{desc}</Tx>
            </View>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: pick === label ? T.primary : T.muted, alignItems: 'center', justifyContent: 'center' }}>
                {pick === label ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: T.primary }} /> : null}
            </View>
        </Pressable>
    );
    return (
        <Page title="Payment Options">
            <View style={{ margin: 14, marginBottom: 4, flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: alpha(T.primary, 0.12) }}>
                <Ionicons name="shield-checkmark-outline" size={18} color={T.primary} />
                <Tx style={{ flex: 1, marginLeft: 8, color: T.text, fontSize: 11.5, fontWeight: '700' }}>Your payment details are safe and secure</Tx>
            </View>
            <View style={{ paddingHorizontal: 14 }}>
                <Tx style={{ color: T.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 12, marginBottom: 8 }}>PAY ONLINE</Tx>
                {!online ? <Tx style={{ color: T.muted, fontSize: 10.5, marginBottom: 8 }}>Online payment is not switched on for this shop yet. This is how it will look when it is.</Tx> : null}
                {row('Google Pay (UPI)', 'Pay with Google Pay. It opens directly', null, 'G', '#4285F4')}
                {row('PhonePe (UPI)', 'Pay with PhonePe. It opens directly', null, 'P', '#5F259F')}
                {row('Paytm (UPI)', 'Pay with Paytm. It opens directly', null, 'P', '#00B9F1')}
                {row('Credit / Debit card', 'Visa, Mastercard, RuPay. Confirm with your bank OTP', 'card-outline', null, null, true)}
                <Tx style={{ color: T.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 12, marginBottom: 8 }}>PAY ON DELIVERY</Tx>
                {row('Cash on Delivery', 'Pay in cash or UPI when the order arrives', 'cash-outline', null, null)}
            </View>
        </Page>
    );
}

function CardPage() {
    const { T, nav } = useP();
    return (
        <Page title="Card details" footer={<Dock><Btn title="Pay securely" onPress={() => nav.replaceWith('placed')} style={{ flex: 1 }} icon="lock-closed-outline" /></Dock>}>
            <View style={{ padding: 14 }}>
                <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 120, borderRadius: 18, padding: 16, justifyContent: 'space-between', marginBottom: 14 }}>
                    <Ionicons name="card" size={26} color={T.onPrimary} />
                    <Tx style={{ color: T.onPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 2 }}>•••• •••• •••• 4242</Tx>
                    <Tx style={{ color: T.onPrimary, fontSize: 10.5, opacity: 0.9 }}>{USER.name.toUpperCase()}   12/28</Tx>
                </LinearGradient>
                <Field label="Card number" value="4242 4242 4242 4242" />
                <View style={{ flexDirection: 'row' }}>
                    <View style={{ flex: 1, marginRight: 8 }}><Field label="Expiry" value="12 / 28" /></View>
                    <View style={{ flex: 1 }}><Field label="CVV" value="•••" /></View>
                </View>
                <Field label="Name on card" value={USER.name} />
                <Tx style={{ color: T.muted, fontSize: 10.5, marginTop: 4 }}>Card details are used for this payment only. They are never saved.</Tx>
            </View>
        </Page>
    );
}

/* ============================== ORDER PLACED, ORDER DETAIL ============================== */
function PlacedPage() {
    const { T, C, nav } = useP();
    const rows = [['Total', '₹587'], ['Payment', nav.pay], ['Arriving in about', `${C.orders.prepTimeMin || 25} min`]];
    return (
        <View style={{ flex: 1, backgroundColor: T.background, padding: 18 }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 130, height: 130, alignItems: 'center', justifyContent: 'center' }}>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <View key={i} style={{ position: 'absolute', width: 7, height: i % 2 ? 7 : 11, borderRadius: i % 2 ? 4 : 2, backgroundColor: [T.primary, T.accent, T.ok, T.primaryLight][i % 4], transform: [{ rotate: `${i * 45}deg` }, { translateY: -58 }] }} />
                    ))}
                    <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="checkmark" size={50} color={T.onPrimary} />
                    </LinearGradient>
                </View>
                <Tx style={{ color: T.text, fontSize: 25, fontWeight: '900', letterSpacing: -0.5, marginTop: 10 }}>Order placed!</Tx>
                <Tx style={{ color: T.muted, fontSize: 12, textAlign: 'center', marginTop: 6 }}>Order #2481 is on its way to the kitchen.</Tx>
                <View style={{ alignSelf: 'stretch', marginTop: 18, borderRadius: 16, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, paddingHorizontal: 14 }}>
                    <Glow radius={16} />
                    {rows.map(([k, v], i) => (
                        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: i < rows.length - 1 ? HAIR : 0, borderBottomColor: T.border }}>
                            <Tx style={{ color: T.muted, fontSize: 11.5, fontWeight: '600' }}>{k}</Tx>
                            <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '800' }}>{v}</Tx>
                        </View>
                    ))}
                </View>
            </View>
            <Btn title="Track order" icon="navigate-outline" onPress={() => nav.replaceWith('orderDetail', { delivered: false })} />
            <Pressable onPress={() => nav.tab('home')} style={{ alignSelf: 'center', paddingVertical: 12 }}><Tx style={{ color: T.primary, fontSize: 12.5, fontWeight: '800' }}>Back to menu</Tx></Pressable>
        </View>
    );
}

function OrderDetailPage({ delivered }) {
    const { T, nav } = useP();
    const live = ORDERS.live;
    const accent = delivered ? T.ok : T.primary;
    const items = [[DISHES[0], 2], [DISHES[7], 1]];
    const total = 587;
    return (
        <Page
            title={`Order #${delivered ? ORDERS.past[0].no : live.no}`}
            footer={(
                <Dock>
                    {delivered ? <Btn title="Reorder" onPress={() => nav.tab('cart')} style={{ flex: 1 }} /> : (
                        <>
                            <Btn title="Cancel order" kind="danger" style={{ flex: 1, marginRight: 10 }} />
                            <Btn title="Reorder" onPress={() => nav.tab('cart')} style={{ flex: 1.4 }} />
                        </>
                    )}
                </Dock>
            )}
        >
            <View style={{ margin: 14, borderRadius: 22, overflow: 'hidden' }}>
                <LinearGradient colors={[accent, mix(accent, '#000000', 0.28)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16 }}>
                    <View style={[s.blob, { top: -40, right: -20, width: 120, height: 120 }]} />
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                            <Tx style={{ color: '#FFFFFF', fontSize: 9.5, fontWeight: '900', letterSpacing: 1, opacity: 0.85 }}>DELIVERY  ·  {delivered ? 'Yesterday, 8:42 PM' : 'Today, 1:05 PM'}</Tx>
                            <Tx style={{ color: '#FFFFFF', fontSize: 23, fontWeight: '900', letterSpacing: -0.5, marginTop: 5 }}>{delivered ? 'Delivered' : STEPS[live.step]}</Tx>
                            <Tx style={{ color: '#FFFFFF', fontSize: 11, opacity: 0.92, marginTop: 4 }}>{delivered ? 'Delivered on 14 Oct, 8:42 PM' : `Usually ready in about ${live.eta} min`}</Tx>
                        </View>
                        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name={delivered ? 'checkmark-circle-outline' : 'restaurant-outline'} size={26} color="#FFFFFF" />
                        </View>
                    </View>
                    {!delivered ? (
                        <View style={{ flexDirection: 'row', marginTop: 14 }}>
                            {STEPS.map((st, k) => <View key={st} style={{ flex: 1, height: 5, borderRadius: 3, marginRight: 4, backgroundColor: k <= live.step ? '#FFFFFF' : 'rgba(255,255,255,0.28)' }} />)}
                        </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: HAIR, borderTopColor: 'rgba(255,255,255,0.35)' }}>
                        {[['TOTAL', `₹${total}`], ['ITEMS', '3'], ['PAYMENT', nav.pay.split(' (')[0]]].map(([k, v]) => (
                            <View key={k} style={{ flex: 1 }}>
                                <Tx style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, opacity: 0.75 }}>{k}</Tx>
                                <Tx numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '900', marginTop: 2 }}>{v}</Tx>
                            </View>
                        ))}
                    </View>
                </LinearGradient>
            </View>

            {!delivered ? (
                <Card style={{ marginTop: 0 }}>
                    <View style={{ height: 96, borderRadius: 12, backgroundColor: T.soft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                        {[18, 46, 74].map((top) => <View key={top} style={{ position: 'absolute', left: -10, right: -10, top, height: 6, backgroundColor: alpha(T.muted, 0.25), transform: [{ rotate: '-8deg' }] }} />)}
                        <View style={{ position: 'absolute', left: 52, top: 30, width: 28, height: 28, borderRadius: 14, backgroundColor: T.primary, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="bicycle" size={14} color={T.onPrimary} /></View>
                        <View style={{ position: 'absolute', right: 52, top: 40, width: 26, height: 26, borderRadius: 13, backgroundColor: T.ok, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="home" size={13} color="#FFFFFF" /></View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: alpha(T.primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Tx style={{ color: T.primary, fontSize: 14, fontWeight: '900' }}>R</Tx></View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '800' }}>Ravi is on the way</Tx>
                            <Tx style={{ color: T.muted, fontSize: 10.5 }}>Arriving in about 8 min · PIN 4821</Tx>
                        </View>
                        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="call" size={15} color={T.onPrimary} /></View>
                    </View>
                </Card>
            ) : null}

            <Card>
                <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900', marginBottom: 6 }}>Order status</Tx>
                {STEPS.map((st, k) => {
                    const done = delivered || k <= live.step;
                    return (
                        <View key={st} style={{ flexDirection: 'row' }}>
                            <View style={{ width: 24, alignItems: 'center' }}>
                                <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: done ? T.ok : T.muted, backgroundColor: done ? T.ok : T.surface }} />
                                {k < STEPS.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 20, backgroundColor: done && (delivered || k < live.step) ? T.ok : T.border }} /> : null}
                            </View>
                            <View style={{ flex: 1, paddingBottom: 10 }}>
                                <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: done ? '800' : '600', opacity: done ? 1 : 0.5, marginLeft: 6 }}>{st}</Tx>
                            </View>
                        </View>
                    );
                })}
            </Card>

            <Card>
                <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900', marginBottom: 6 }}>Items</Tx>
                {items.map(([d, q]) => (
                    <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                        <Photo emoji={d.emoji} size={40} radius={10} />
                        <View style={{ backgroundColor: alpha(T.primary, 0.12), borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 10 }}><Tx style={{ color: T.primary, fontSize: 11, fontWeight: '900' }}>{q}×</Tx></View>
                        <Tx numberOfLines={1} style={{ flex: 1, marginHorizontal: 8, color: T.text, fontSize: 12, fontWeight: '700' }}>{d.name}</Tx>
                        <Tx style={{ color: T.text, fontSize: 12, fontWeight: '800' }}>₹{d.price * q}</Tx>
                    </View>
                ))}
            </Card>

            <Card>
                <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900', marginBottom: 6 }}>Bill details</Tx>
                {[['Subtotal', '₹587'], ['Delivery fee', 'Free'], ['Packaging', '₹0']].map(([k, v]) => (
                    <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                        <Tx style={{ color: T.muted, fontSize: 11.5 }}>{k}</Tx>
                        <Tx style={{ color: v === 'Free' ? T.ok : T.text, fontSize: 11.5, fontWeight: '700' }}>{v}</Tx>
                    </View>
                ))}
                <View style={{ height: HAIR, backgroundColor: T.border, marginVertical: 6 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>Total</Tx><Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>₹{total}</Tx></View>
            </Card>

            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="location-outline" size={16} color={T.primary} />
                    <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900', marginLeft: 6 }}>Delivery address</Tx>
                </View>
                <Tx style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>Home · {USER.name}</Tx>
                <Tx style={{ color: T.muted, fontSize: 11 }}>Flat 402, Green Park Apartments, Sector 12, Indore, 452001</Tx>
            </Card>

            {delivered ? (
                <>
                    <Card>
                        <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900', marginBottom: 8 }}>Invoice</Tx>
                        <View style={{ flexDirection: 'row' }}>
                            <Btn title="View" kind="outline" icon="eye-outline" style={{ flex: 1, marginRight: 8 }} />
                            <Btn title="Download" icon="download-outline" style={{ flex: 1 }} />
                        </View>
                    </Card>
                    <Card>
                        <Tx style={{ color: T.text, fontSize: 13, fontWeight: '900' }}>Rate this order</Tx>
                        <View style={{ flexDirection: 'row', marginTop: 8 }}>
                            {[1, 2, 3, 4, 5].map((k) => <Ionicons key={k} name={k <= 4 ? 'star' : 'star-outline'} size={28} color={k <= 4 ? '#F5A623' : '#BBBBBB'} style={{ marginRight: 8 }} />)}
                        </View>
                        <Tx style={{ color: '#F5A623', fontSize: 11.5, fontWeight: '800', marginTop: 4 }}>Very good</Tx>
                    </Card>
                </>
            ) : null}
        </Page>
    );
}

/* ============================== LOGIN ============================== */
function LoginPage() {
    const { T, C, nav } = useP();
    const [otp, setOtp] = useState(false);
    return (
        <View style={{ flex: 1, backgroundColor: T.background }}>
            <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <View style={[s.blob, { top: -60, right: -50, width: 200, height: 200 }]} />
                <View style={[s.blob, { top: 90, left: -60, width: 140, height: 140, opacity: 0.6 }]} />
                <View style={{ padding: 5, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.28)' }}>
                    {C.logo
                        ? <Image source={{ uri: C.logo }} style={{ width: 70, height: 70, borderRadius: 21 }} />
                        : <View style={{ width: 70, height: 70, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 34 }}>🍽️</Text></View>}
                </View>
                <Tx style={{ color: T.onPrimary, fontSize: 25, fontWeight: '900', marginTop: 12, letterSpacing: 0.2 }}>{C.name}</Tx>
                <Tx style={{ color: T.onPrimary, fontSize: 12, opacity: 0.88, marginTop: 3 }}>{C.tagline}</Tx>
                <Tx style={{ color: T.onPrimary, fontSize: 9.5, opacity: 0.7, marginTop: 10 }}>The shop's hero photos show here (added in Branding)</Tx>
            </LinearGradient>
            <View style={{ marginTop: -26, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: T.surface, padding: 18, paddingBottom: 22 }}>
                {!otp ? (
                    <>
                        <Tx style={{ color: T.text, fontSize: 21, fontWeight: '900' }}>Welcome back</Tx>
                        <Tx style={{ color: T.muted, fontSize: 12, marginTop: 3, marginBottom: 14 }}>Sign in with your mobile number</Tx>
                        <View style={{ flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: T.border, backgroundColor: T.background, padding: 5 }}>
                            <View style={{ height: '100%', paddingHorizontal: 12, borderRadius: 10, backgroundColor: alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}><Tx style={{ color: T.primary, fontSize: 13, fontWeight: '800' }}>+91</Tx></View>
                            <Tx style={{ marginLeft: 12, color: T.text, fontSize: 14, fontWeight: '600' }}>98765 43210</Tx>
                        </View>
                        <Btn title="Get OTP" onPress={() => setOtp(true)} style={{ marginTop: 14 }} />
                    </>
                ) : (
                    <>
                        <Tx style={{ color: T.text, fontSize: 21, fontWeight: '900' }}>Verify OTP</Tx>
                        <Tx style={{ color: T.muted, fontSize: 12, marginTop: 3, marginBottom: 12 }}>Sent to +91 98765 43210</Tx>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            {[4, 8, 2, 6, 1, 7].map((n, i) => (
                                <View key={i} style={{ width: 40, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: T.primary, backgroundColor: T.background, alignItems: 'center', justifyContent: 'center' }}>
                                    <Tx style={{ color: T.text, fontSize: 18, fontWeight: '800' }}>{n}</Tx>
                                </View>
                            ))}
                        </View>
                        <Btn title="Verify and continue" onPress={() => nav.tab('home')} style={{ marginTop: 14 }} />
                        <Tx style={{ color: T.muted, fontSize: 11, textAlign: 'center', marginTop: 10 }}>Resend code in 24s</Tx>
                    </>
                )}
                {C.features.guestBrowsing !== false ? (
                    <Pressable onPress={() => nav.tab('home')} style={{ alignSelf: 'center', paddingTop: 12 }}><Tx style={{ color: T.primary, fontSize: 12.5, fontWeight: '800' }}>Skip for now</Tx></Pressable>
                ) : null}
            </View>
        </View>
    );
}

/* ============================== SHEETS: filters, addresses, edit profile ============================== */
function FilterOverlay() {
    const { T, C, nav } = useP();
    const style = C.brand.filterStyle;
    const [tab, setTab] = useState('sort');
    const secs = [
        { k: 'sort', t: 'Sort by', opts: ['Popular', 'Rating high to low', 'Price low to high', 'Price high to low'], radio: true },
        { k: 'type', t: 'Dish type', opts: ['Veg only', 'Bestsellers', 'Has an offer', 'Rating 4.0+'] },
        { k: 'price', t: 'Price', opts: ['Under ₹150', '₹150 - ₹300', 'Above ₹300'], chips: true },
    ];
    const opts = (sec) => (
        sec.chips ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {sec.opts.map((o, i) => (
                    <View key={o} style={{ borderWidth: 1.5, borderColor: i === 0 ? T.primary : T.border, backgroundColor: i === 0 ? alpha(T.primary, 0.12) : 'transparent', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 6, marginBottom: 6 }}>
                        <Tx style={{ color: i === 0 ? T.primary : T.text, fontSize: 11, fontWeight: '700' }}>{o}</Tx>
                    </View>
                ))}
            </View>
        ) : sec.opts.map((o, i) => (
            <View key={o} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                <View style={{ width: 18, height: 18, borderRadius: sec.radio ? 9 : 5, borderWidth: 2, borderColor: i === 0 ? T.primary : '#BBBBBB', backgroundColor: !sec.radio && i === 0 ? T.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {sec.radio && i === 0 ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.primary }} /> : null}
                    {!sec.radio && i === 0 ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
                </View>
                <Tx style={{ color: T.text, fontSize: 12, fontWeight: '600', marginLeft: 10 }}>{o}</Tx>
            </View>
        ))
    );
    const rail = style === 'rail';
    const cur = secs.find((x) => x.k === tab) || secs[0];
    return (
        <View style={[StyleSheet.absoluteFill, { justifyContent: style === 'dialog' ? 'center' : 'flex-end', padding: style === 'dialog' ? 16 : 0 }]}>
            <Pressable onPress={nav.closeSheet} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
            <View style={{ backgroundColor: T.background, padding: 14, borderRadius: style === 'dialog' ? 20 : 0, borderTopLeftRadius: style === 'dialog' ? 20 : 24, borderTopRightRadius: style === 'dialog' ? 20 : 24, maxHeight: '78%' }}>
                {style !== 'dialog' ? <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: T.border, marginBottom: 10 }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Tx style={{ color: T.text, fontSize: 16, fontWeight: '900' }}>Filters</Tx>
                    <Pressable onPress={nav.closeSheet} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={14} color={T.text} /></Pressable>
                </View>
                {rail ? (
                    <View style={{ flexDirection: 'row', marginTop: 10, height: 200, borderTopWidth: HAIR, borderTopColor: T.border }}>
                        <View style={{ width: 92, backgroundColor: T.surface, borderRightWidth: HAIR, borderRightColor: T.border }}>
                            {secs.map((x) => (
                                <Pressable key={x.k} onPress={() => setTab(x.k)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, backgroundColor: x.k === cur.k ? T.background : 'transparent' }}>
                                    <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: x.k === cur.k ? T.primary : 'transparent', marginRight: 8 }} />
                                    <Tx style={{ color: x.k === cur.k ? T.text : T.muted, fontSize: 11.5, fontWeight: x.k === cur.k ? '900' : '700' }}>{x.t}</Tx>
                                </Pressable>
                            ))}
                        </View>
                        <View style={{ flex: 1, padding: 12 }}>
                            <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '900', marginBottom: 4 }}>{cur.t}</Tx>
                            {opts(cur)}
                        </View>
                    </View>
                ) : (
                    <ScrollView style={{ maxHeight: 250, marginTop: 6 }} showsVerticalScrollIndicator={false}>
                        {secs.map((x) => (
                            <View key={x.k}>
                                <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '900', marginTop: 10, marginBottom: 2 }}>{x.t}</Tx>
                                {opts(x)}
                            </View>
                        ))}
                    </ScrollView>
                )}
                <Btn title="Show 8 dishes" onPress={nav.closeSheet} style={{ marginTop: 10 }} />
            </View>
        </View>
    );
}

function AddressSheet() {
    const { T, nav } = useP();
    const [form, setForm] = useState(false);
    const [saveAs, setSaveAs] = useState('Home');
    const addrs = [
        { id: 1, label: 'Home', icon: 'home-outline', line: 'Flat 402, Green Park Apartments, Sector 12, Indore', on: true, def: true },
        { id: 2, label: 'Work', icon: 'briefcase-outline', line: '2nd floor, Tech Plaza, Vijay Nagar, Indore', on: false, def: false },
    ];
    return (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
            <Pressable onPress={nav.closeSheet} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
            <View style={{ backgroundColor: T.background, padding: 14, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '86%' }}>
                <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: T.border, marginBottom: 10 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {form ? <Pressable onPress={() => setForm(false)} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}><Ionicons name="chevron-back" size={16} color={T.text} /></Pressable> : null}
                    <View style={{ flex: 1 }}>
                        <Tx style={{ color: T.text, fontSize: 17, fontWeight: '900' }}>{form ? 'New address' : 'Deliver to'}</Tx>
                        <Tx style={{ color: T.muted, fontSize: 10.5 }}>{form ? 'Add the details the rider needs' : 'Pick where this order should go'}</Tx>
                    </View>
                    <Pressable onPress={nav.closeSheet} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={16} color={T.text} /></Pressable>
                </View>
                {!form ? (
                    <ScrollView style={{ marginTop: 12 }} showsVerticalScrollIndicator={false}>
                        {addrs.map((a) => (
                            <Pressable key={a.id} onPress={nav.closeSheet} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, marginBottom: 10, borderWidth: a.on ? 2 : 1, borderColor: a.on ? T.primary : T.border, backgroundColor: T.surface }}>
                                <Glow radius={16} />
                                <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: a.on ? T.primary : alpha(T.primary, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={a.icon} size={19} color={a.on ? T.onPrimary : T.primary} /></View>
                                <View style={{ flex: 1, marginLeft: 10 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Tx style={{ color: T.text, fontSize: 13, fontWeight: '800' }}>{a.label}</Tx>
                                        {a.def ? <View style={{ marginLeft: 8, backgroundColor: alpha(T.primary, 0.12), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Tx style={{ color: T.primary, fontSize: 8.5, fontWeight: '900' }}>DEFAULT</Tx></View> : null}
                                    </View>
                                    <Tx style={{ color: T.muted, fontSize: 10.5, marginTop: 2 }}>{USER.name} · 98765 43210</Tx>
                                    <Tx numberOfLines={2} style={{ color: T.muted, fontSize: 10.5 }}>{a.line}</Tx>
                                </View>
                                {a.on ? <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center', marginRight: 6 }}><Ionicons name="checkmark" size={12} color={T.onPrimary} /></View> : null}
                                <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: T.border, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 5 }}>
                                    <Ionicons name="create-outline" size={12} color={T.primary} />
                                    <Tx style={{ color: T.primary, fontSize: 10.5, fontWeight: '800', marginLeft: 3 }}>Edit</Tx>
                                </View>
                            </Pressable>
                        ))}
                        <Pressable onPress={() => setForm(true)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: T.radius, borderWidth: 1.5, borderStyle: 'dashed', borderColor: T.primary, backgroundColor: alpha(T.primary, 0.1) }}>
                            <Ionicons name="add-circle" size={18} color={T.primary} />
                            <Tx style={{ color: T.primary, fontSize: 13, fontWeight: '800', marginLeft: 6 }}>Add new address</Tx>
                        </Pressable>
                    </ScrollView>
                ) : (
                    <ScrollView style={{ marginTop: 10 }} showsVerticalScrollIndicator={false}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: T.ok, backgroundColor: alpha(T.ok, 0.1), marginBottom: 8 }}>
                            <Ionicons name="locate" size={18} color={T.ok} />
                            <View style={{ marginLeft: 10 }}>
                                <Tx style={{ color: T.text, fontSize: 12.5, fontWeight: '800' }}>Use my current location</Tx>
                                <Tx style={{ color: T.muted, fontSize: 10 }}>Fastest way to set a precise delivery spot</Tx>
                            </View>
                        </View>
                        <Tx style={{ color: T.muted, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, marginTop: 6, marginBottom: 6 }}>SAVE AS</Tx>
                        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                            {['Home', 'Work', 'Other'].map((l) => (
                                <Pressable key={l} onPress={() => setSaveAs(l)} style={{ borderWidth: 1.5, borderColor: saveAs === l ? T.primary : T.border, backgroundColor: saveAs === l ? alpha(T.primary, 0.12) : T.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 }}>
                                    <Tx style={{ color: saveAs === l ? T.primary : T.text, fontSize: 11.5, fontWeight: '800' }}>{l}</Tx>
                                </Pressable>
                            ))}
                        </View>
                        <Field label="Receiver name" value={USER.name} />
                        <Field label="Phone (10 digits)" value="98765 43210" />
                        <Field label="Flat, building, street *" value="Flat 402, Green Park Apartments" />
                        <View style={{ flexDirection: 'row' }}>
                            <View style={{ flex: 1.4, marginRight: 8 }}><Field label="City" value="Indore" /></View>
                            <View style={{ flex: 1 }}><Field label="Pincode" value="452001" /></View>
                        </View>
                        <Btn title="Save address" onPress={() => setForm(false)} style={{ marginTop: 4 }} />
                    </ScrollView>
                )}
            </View>
        </View>
    );
}

function EditDialog() {
    const { T, nav } = useP();
    return (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', padding: 18 }]}>
            <Pressable onPress={nav.closeSheet} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
            <View style={{ width: '100%', borderRadius: 20, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, padding: 16 }}>
                <Tx style={{ color: T.text, fontSize: 16, fontWeight: '900', marginBottom: 10 }}>Edit profile</Tx>
                <Field label="Name" value={USER.name} />
                <Field label="Email (optional)" value={USER.email} />
                <Field label="Phone" value={USER.phone} />
                <Tx style={{ color: T.muted, fontSize: 10, marginBottom: 10 }}>Your phone number is your login, so it cannot be changed.</Tx>
                <View style={{ flexDirection: 'row' }}>
                    <Btn title="Cancel" kind="outline" onPress={nav.closeSheet} style={{ flex: 1, marginRight: 8 }} />
                    <Btn title="Save" onPress={nav.closeSheet} style={{ flex: 1.3 }} />
                </View>
            </View>
        </View>
    );
}

/* ============================== BOTTOM TABS ============================== */
const TAB = {
    home: ['Home', 'home'], search: ['Search', 'search'], cart: ['Cart', 'cart'], orders: ['Orders', 'receipt'],
    profile: ['Account', 'person'], offers: ['Offers', 'pricetags'],
};

function TabBar({ ids, index, onPick }) {
    const { T, C } = useP();
    const floating = C.brand.tabBarStyle === 'floating';
    const [w, setW] = useState(0);
    const slide = useRef(new Animated.Value(index)).current;
    useEffect(() => {
        if (C.brand.motion === 'off') slide.setValue(index);
        else Animated.timing(slide, { toValue: index, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [index, C.brand.motion]);
    const n = ids.length;
    const items = ids.map((id, i) => {
        const [label, icon] = TAB[id] || [id, 'ellipse'];
        const on = i === index;
        const color = on ? T.primary : T.muted;
        return (
            <Pressable key={id} onPress={() => onPick(i)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                {!floating ? (
                    <View style={{ width: 46, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(T.primary, 0.14) : 'transparent' }}>
                        <Ionicons name={on ? icon : `${icon}-outline`} size={19} color={color} />
                    </View>
                ) : <Ionicons name={on ? icon : `${icon}-outline`} size={20} color={color} />}
                <Tx numberOfLines={1} style={{ color, fontSize: 9.5, fontWeight: '700', marginTop: floating ? 2 : 1 }}>{label}</Tx>
            </Pressable>
        );
    });
    if (!floating) {
        return (
            <View style={{ flexDirection: 'row', height: 54, backgroundColor: T.background, borderTopWidth: HAIR, borderTopColor: T.border, paddingTop: 4 }}>
                {items}
            </View>
        );
    }
    return (
        <View style={{ backgroundColor: T.background, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 }}>
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', height: 56, borderRadius: 28, backgroundColor: T.surface, borderWidth: HAIR, borderColor: T.border, elevation: 6, shadowColor: T.dark ? '#000' : T.primary, shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
                {w ? (
                    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: w / n - 10, borderRadius: 22, backgroundColor: alpha(T.primary, 0.14), transform: [{ translateX: Animated.add(Animated.multiply(slide, w / n), 5) }] }} />
                ) : null}
                {items}
            </View>
        </View>
    );
}

/* ============================== THE PHONE ============================== */
// a page that opens on top (a stack screen): it slides in from the right, like the real app
function Slide({ children, motion }) {
    const v = useRef(new Animated.Value(motion === 'off' ? 1 : 0)).current;
    useEffect(() => {
        if (motion !== 'off') Animated.timing(v, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, []);
    return (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }]}>
            {children}
        </Animated.View>
    );
}

function Phone({ C, dark, fonts, jump }) {
    const T = useMemo(() => tokens(C.brand, dark), [C.brand, dark]);
    const ids = useMemo(() => {
        const base = C.tabs.filter((x) => x !== 'cart' && TAB[x]);
        const out = base.slice();
        out.splice(Math.min(2, out.length), 0, 'cart');
        return out;
    }, [C.tabs]);
    const [index, setIndex] = useState(0);
    const [stack, setStack] = useState([]);          // pages opened on top of the tabs: [{ name, params }]
    const [sheet, setSheet] = useState(null);        // 'filters' | 'address' | 'edit'
    const [closed, setClosed] = useState(false);     // the "shop is closed" state
    const [emptyCart, setEmptyCart] = useState(false);
    const [q, setQ] = useState('');
    const [pay, setPay] = useState('Cash on Delivery');
    const [seen, setSeen] = useState({ 0: true });
    const pos = useRef(new Animated.Value(0)).current;
    const cur = Math.min(index, ids.length - 1);
    const n = ids.length;
    const floating = C.brand.tabBarStyle === 'floating';
    const tabH = floating ? 70 : 54;

    useEffect(() => {
        if (C.brand.motion === 'off') pos.setValue(cur);
        else Animated.timing(pos, { toValue: cur, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [cur, C.brand.motion]);

    const tabIndex = (id) => Math.max(0, ids.indexOf(id));
    const pick = (i) => { setSeen((x) => ({ ...x, [i]: true })); setIndex(i); setStack([]); setSheet(null); };

    const nav = {
        closed, emptyCart, q, setQ, pay, setPay,
        tab: (id) => { pick(tabIndex(id)); if (id !== 'cart') setEmptyCart(false); },
        push: (name, params) => setStack((st) => [...st, { name, params }]),
        pop: () => setStack((st) => st.slice(0, -1)),
        replaceWith: (name, params) => setStack([{ name, params }]),
        reset: (names) => setStack(names.map((name) => ({ name }))),
        sheet: (name) => setSheet(name),
        closeSheet: () => setSheet(null),
    };

    // the "Screens" bar: jump straight to any screen
    useEffect(() => {
        if (!jump || !jump.n) return;
        const k = jump.key;
        setStack([]); setSheet(null); setClosed(false); setEmptyCart(false); setQ('');
        const go = (id) => { const i = tabIndex(id); setSeen((x) => ({ ...x, [i]: true })); setIndex(i); };
        const top = (name, params) => setStack([{ name, params }]);
        switch (k) {
            case 'login': top('login'); break;
            case 'home': go('home'); break;
            case 'search': go('search'); break;
            case 'results': go('search'); setQ('biryani'); break;
            case 'item': go('home'); top('item', { d: DISHES[0] }); break;
            case 'cart': go('cart'); break;
            case 'emptycart': go('cart'); setEmptyCart(true); break;
            case 'payment': go('cart'); top('payment'); break;
            case 'card': go('cart'); top('card'); break;
            case 'placed': go('cart'); top('placed'); break;
            case 'orders': go('orders'); break;
            case 'live': go('orders'); top('orderDetail', { delivered: false }); break;
            case 'delivered': go('orders'); top('orderDetail', { delivered: true }); break;
            case 'offers': go('home'); top('offers'); break;
            case 'favourites': go('profile'); top('favourites'); break;
            case 'bestsellers': go('home'); top('bestsellers'); break;
            case 'notifications': go('home'); top('notifications'); break;
            case 'account': go('profile'); break;
            case 'addresses': go('home'); setSheet('address'); break;
            case 'edit': go('profile'); setSheet('edit'); break;
            case 'filters': go('home'); setSheet('filters'); break;
            case 'closed': go('home'); setClosed(true); break;
            default: break;
        }
    }, [jump && jump.n]);

    const top = stack[stack.length - 1];
    const fullH = H - 2 * FRAME - STATUS;

    const tabScreen = (id) => {
        if (id === 'home') return <HomeScreen />;
        if (id === 'search') return <SearchScreen />;
        if (id === 'cart') return <CartScreen />;
        if (id === 'orders') return <OrdersScreen />;
        if (id === 'offers') return <OffersTab />;
        return <AccountScreen />;
    };
    const page = (p) => {
        switch (p.name) {
            case 'item': return <ItemPage d={p.params.d} />;
            case 'offers': return <OffersPage />;
            case 'favourites': return <FavouritesPage />;
            case 'bestsellers': return <BestsellersPage />;
            case 'notifications': return <NotificationsPage />;
            case 'payment': return <PaymentPage />;
            case 'card': return <CardPage />;
            case 'placed': return <PlacedPage />;
            case 'orderDetail': return <OrderDetailPage delivered={!!p.params?.delivered} />;
            case 'login': return <LoginPage />;
            default: return null;
        }
    };

    // the status bar takes the colour of the page under it
    const onHome = !top && cur === 0;
    const loginTop = !!top && top.name === 'login';
    const statusBg = loginTop ? T.primaryLight : onHome ? (T.look !== 'bold' ? T.wash : T.primaryLight) : T.background;
    const statusFg = (loginTop || (onHome && T.look === 'bold')) ? T.onPrimary : T.text;

    return (
        <Ctx.Provider value={{ T, C, fonts, nav }}>
            <View style={{ width: W, height: H, borderRadius: 34, borderWidth: FRAME, borderColor: '#111114', backgroundColor: T.background, overflow: 'hidden' }}>
                <View style={{ height: STATUS, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, backgroundColor: statusBg }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: statusFg }}>9:41</Text>
                    <View style={{ width: 54, height: 14, borderRadius: 7, backgroundColor: '#111114' }} />
                    <Ionicons name="battery-full" size={13} color={statusFg} />
                </View>
                <View style={{ height: fullH, overflow: 'hidden' }}>
                    {/* the tabs and the bar under them */}
                    <View style={{ height: fullH - tabH, overflow: 'hidden' }}>
                        {ids.map((id, i) => (seen[i] || i === cur ? (
                            <Animated.View
                                key={id}
                                style={[StyleSheet.absoluteFill, { transform: [{ translateX: n > 1 ? pos.interpolate({ inputRange: [0, n - 1], outputRange: [i * (W + 24), (i - (n - 1)) * (W + 24)] }) : 0 }] }]}
                            >
                                {tabScreen(id)}
                            </Animated.View>
                        ) : null))}
                    </View>
                    <TabBar ids={ids} index={cur} onPick={pick} />
                    {/* pages opened on top of the tabs cover the tab bar, like in the real app */}
                    {stack.map((p, i) => (
                        <Slide key={`${i}-${p.name}`} motion={C.brand.motion}>{page(p)}</Slide>
                    ))}
                    {sheet === 'filters' ? <FilterOverlay /> : null}
                    {sheet === 'address' ? <AddressSheet /> : null}
                    {sheet === 'edit' ? <EditDialog /> : null}
                </View>
            </View>
        </Ctx.Provider>
    );
}

/* ============================== what the panel places on a screen ============================== */
function Scaled({ scale, children }) {
    return (
        <View style={{ width: W * scale, height: H * scale, alignSelf: 'center', overflow: 'hidden' }}>
            <View style={{ width: W, height: H, transform: [{ scale }], transformOrigin: 'top left' }}>{children}</View>
        </View>
    );
}

// every screen of the app, in the order a customer meets them
const JUMPS = [
    ['login', 'Login'], ['home', 'Home'], ['search', 'Search'], ['results', 'Search results'], ['item', 'Dish page'],
    ['cart', 'Cart'], ['emptycart', 'Empty cart'], ['payment', 'Payment options'], ['card', 'Card details'], ['placed', 'Order placed'],
    ['orders', 'Orders'], ['live', 'Live order'], ['delivered', 'Delivered order'], ['offers', 'Offers'], ['favourites', 'Favourites'],
    ['bestsellers', 'Bestsellers'], ['notifications', 'Notifications'], ['account', 'Account'], ['addresses', 'Addresses'],
    ['edit', 'Edit profile'], ['filters', 'Filters'], ['closed', 'Shop closed'],
];

function ScreensBar({ onJump, active, t }) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 6 }} style={{ marginBottom: 6, flexGrow: 0 }}>
            {JUMPS.map(([k, label]) => (
                <Pressable key={k} onPress={() => onJump(k)} style={{ borderRadius: 14, borderWidth: 1, borderColor: active === k ? t.primary : t.border, backgroundColor: active === k ? t.primarySoft : t.surface, paddingHorizontal: 11, paddingVertical: 6, marginRight: 6 }}>
                    <Text style={{ color: active === k ? t.primary : t.text, fontSize: font.xs, fontWeight: '800' }}>{label}</Text>
                </Pressable>
            ))}
        </ScrollView>
    );
}

// scale: how big the phone is drawn (0.46 = a pinned mini phone). "Full size" opens a big one with every screen one tap away.
// screens: show the "Screens" bar under the title (always on in the full-size view).
export default function PhonePreview({ config, scale = 0.6, title = 'Live preview', collapsible = false, screens = false }) {
    const t = useTheme();
    const { width: sw, height: sh } = useWindowDimensions();
    const [dark, setDark] = useState(false);
    const [open, setOpen] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [jump, setJump] = useState({ key: '', n: 0 });
    const [jumpBig, setJumpBig] = useState({ key: '', n: 0 });
    const [fonts] = useFonts(FONT_MAP);
    const C = useMemo(() => normalize(config), [config]);
    const fit = Math.min(1.1, (sw - 24) / W, (sh - 190) / H);

    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }}>{title}</Text>
                    {collapsible && hidden ? null : <Text style={{ color: t.muted, fontSize: font.xs }}>Tap through the app. "Full size" has every screen.</Text>}
                </View>
                <Pressable onPress={() => setDark((d) => !d)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: dark ? t.primary : t.border, backgroundColor: dark ? t.primarySoft : t.surface, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6 }}>
                    <Ionicons name={dark ? 'moon' : 'moon-outline'} size={13} color={dark ? t.primary : t.muted} />
                    <Text style={{ color: dark ? t.primary : t.muted, fontSize: font.xs, fontWeight: '800', marginLeft: 4 }}>Dark</Text>
                </Pressable>
                <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: t.primary, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name="expand-outline" size={13} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontSize: font.xs, fontWeight: '800', marginLeft: 4 }}>Full size</Text>
                </Pressable>
                {collapsible ? (
                    <Pressable onPress={() => setHidden((h) => !h)} hitSlop={8} style={{ marginLeft: 8 }}>
                        <Ionicons name={hidden ? 'chevron-down' : 'chevron-up'} size={20} color={t.muted} />
                    </Pressable>
                ) : null}
            </View>
            {screens && !(collapsible && hidden) ? <ScreensBar t={t} active={jump.key} onJump={(key) => setJump((j) => ({ key, n: j.n + 1 }))} /> : null}
            {collapsible && hidden ? null : <Scaled scale={scale}><Phone C={C} dark={dark} fonts={fonts} jump={jump} /></Scaled>}

            <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', paddingTop: 36 }}>
                    <View style={{ width: '100%', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <View style={{ flex: 1 }}><Text style={{ color: '#FFFFFF', fontSize: font.md, fontWeight: '800' }}>{C.name}</Text><Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: font.xs }}>Pick a screen, or tap through the app</Text></View>
                        <Pressable onPress={() => setDark((d) => !d)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 }}>
                            <Ionicons name={dark ? 'moon' : 'moon-outline'} size={13} color="#FFFFFF" />
                            <Text style={{ color: '#FFFFFF', fontSize: font.xs, fontWeight: '800', marginLeft: 4 }}>Dark</Text>
                        </Pressable>
                        <Pressable onPress={() => setOpen(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="close" size={20} color="#FFFFFF" />
                        </Pressable>
                    </View>
                    <View style={{ width: '100%', paddingHorizontal: 12 }}>
                        <ScreensBar t={t} active={jumpBig.key} onJump={(key) => setJumpBig((j) => ({ key, n: j.n + 1 }))} />
                    </View>
                    <Scaled scale={fit}><Phone C={C} dark={dark} fonts={fonts} jump={jumpBig} /></Scaled>
                </View>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
    hIcon: { width: 30, height: 30, borderRadius: 15, borderWidth: HAIR, alignItems: 'center', justifyContent: 'center' },
    hChip: { flexDirection: 'row', alignItems: 'center', borderRadius: 99, borderWidth: HAIR, paddingHorizontal: 9, paddingVertical: 5, marginRight: 6, marginBottom: 4 },
    big: { marginHorizontal: 14, marginBottom: 12, borderRadius: 18 },
    compact: { flexDirection: 'row', marginHorizontal: 14, marginBottom: 16, padding: 12, paddingBottom: 18, borderRadius: 16 },
    grid: { margin: 6, borderRadius: 14 },
    badge: { position: 'absolute', left: 8, bottom: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
    heart: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
    rate: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#1E8E3E', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, marginTop: 4 },
    rateTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
    notch: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
});
