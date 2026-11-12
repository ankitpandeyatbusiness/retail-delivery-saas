// How the customer WEBSITE looks on a computer, drawn from the settings being edited (no iframe, no deploy).
//
// A 1440 x 810 browser window is drawn and scaled down to the width of the (portrait) screen; "Full screen" turns it 90 degrees so the
// whole window fills the phone when it is held upright. The look is the website's own: when the shop's desktop look follows the mobile app
// it is the mobile look, otherwise the values in brand.desktop (colours, light and dark theme, header, top bar, categories, location bar,
// card shape). It mirrors mobile/src/screens/customers/HomeDesktop.jsx and components/customers/DesktopTopBar.jsx.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, useWindowDimensions } from 'react-native';
import { useFonts } from 'expo-font';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font } from '../../theme';
import { CATEGORIES, DISHES, BANNERS, OFFERS, ORDERS, STEPS, USER } from './previewData';
import { FONT_MAP, pickFont, tokens, normalize, mix, alpha } from './PhonePreview';

const DW = 1440;   // the size of the drawn browser window
const DH = 810;
const BAR = 38;    // the fake browser address bar
const PAGE = 1240; // the widest the website's page grows

// the config the website uses: the mobile one, with the desktop look laid over it unless the desktop follows the mobile app
export function desktopConfig(config) {
    const b = config?.brand || {};
    const d = b.desktop || {};
    if (d.follow !== false) return { ...config, __scroll: b.categoryScroll === true };
    const pick = (k) => (d[k] !== undefined && d[k] !== '' ? d[k] : b[k]);
    const colors = d.colors && Object.keys(d.colors).some((k) => d.colors[k]) ? d.colors : b.colors;
    return {
        ...config,
        brand: { ...b, colors, lightLook: pick('lightLook'), darkLook: pick('darkLook'), headerStyle: pick('headerStyle'), tabBarStyle: pick('tabBarStyle'), categoryStyle: pick('categoryStyle'), locationStyle: pick('locationStyle') },
        home: { ...(config?.home || {}), cardStyle: d.cardStyle || config?.home?.cardStyle },
        __scroll: d.categoryScroll !== undefined ? d.categoryScroll === true : b.categoryScroll === true,
    };
}

const SCREENS = [['home', 'Home'], ['search', 'Search'], ['item', 'Dish'], ['offers', 'Offers'], ['cart', 'Cart'], ['orders', 'Orders'], ['account', 'Account']];

function Site({ C, T, fonts, screen, setScreen, scroll }) {
    const Tx = ({ style, children, ...r }) => {
        const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style || {};
        const w = flat.fontWeight === 'bold' ? 700 : parseInt(flat.fontWeight, 10) || 400;
        const face = T.family && fonts ? { fontFamily: pickFont(T.family, w), fontWeight: 'normal' } : null;
        return <Text {...r} style={[style, face]}>{children}</Text>;
    };
    const floating = C.brand.tabBarStyle === 'floating';
    const hero = C.brand.headerStyle !== 'compact';
    const R = T.radius > 20 ? 22 : T.radius < 6 ? 6 : 14;
    const grad = [T.primaryLight, T.primary, T.primaryDark];
    const card = { backgroundColor: T.surface, borderRadius: R, borderWidth: 1, borderColor: T.border };
    const dishes = C.foodMode === 'veg' ? DISHES.filter((x) => x.veg) : DISHES;
    const cartLines = [[DISHES[0], 2], [DISHES[7], 1]];

    const Icon = ({ name, on, badge, onPress }) => (
        <Pressable onPress={onPress} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: on ? T.soft : 'transparent', alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
            <Ionicons name={name} size={21} color={on ? T.primary : T.text} />
            {badge ? <View style={{ position: 'absolute', top: 3, right: 2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}><Tx style={{ color: T.onPrimary, fontSize: 10, fontWeight: '800' }}>{badge}</Tx></View> : null}
        </Pressable>
    );

    const TopBar = () => {
        const inner = (
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: PAGE, alignSelf: 'center', paddingHorizontal: floating ? 18 : 24, height: 64 }}>
                <Pressable onPress={() => setScreen('home')} style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}>
                        <Tx style={{ color: T.onPrimary, fontWeight: '800', fontSize: 18 }}>{(C.name || 'S').slice(0, 1).toUpperCase()}</Tx>
                    </View>
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: 18, marginLeft: 10, maxWidth: 190 }} numberOfLines={1}>{C.name}</Tx>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 22, paddingHorizontal: 12, height: 38, borderRadius: 19, backgroundColor: T.soft }}>
                    <Ionicons name="location-sharp" size={15} color={T.primary} />
                    <Tx style={{ color: T.text, fontSize: 13, fontWeight: '700', marginLeft: 6, maxWidth: 150 }} numberOfLines={1}>{C.address || 'Pick your location'}</Tx>
                    <Ionicons name="chevron-down" size={14} color={T.muted} style={{ marginLeft: 4 }} />
                </View>
                <Pressable onPress={() => setScreen('search')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', marginHorizontal: 18, height: 40, borderRadius: 20, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, paddingHorizontal: 14 }}>
                    <Ionicons name="search" size={17} color={T.muted} />
                    <Tx style={{ color: T.muted, fontSize: 14, marginLeft: 8 }}>Search dishes, cuisines…</Tx>
                    <View style={{ flex: 1 }} />
                    <Ionicons name="mic-outline" size={17} color={T.muted} />
                </Pressable>
                <Icon name="home-outline" on={screen === 'home'} onPress={() => setScreen('home')} />
                {C.offers.enabled ? <Icon name="pricetag-outline" on={screen === 'offers'} onPress={() => setScreen('offers')} /> : null}
                <Icon name="receipt-outline" on={screen === 'orders'} onPress={() => setScreen('orders')} />
                <Icon name="notifications-outline" />
                <Icon name="bag-handle-outline" on={screen === 'cart'} badge="3" onPress={() => setScreen('cart')} />
                <Pressable onPress={() => setScreen('account')} style={{ marginLeft: 10, width: 38, height: 38, borderRadius: 19, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}>
                    <Tx style={{ color: T.onPrimary, fontWeight: '800', fontSize: 15 }}>{USER.name.slice(0, 1)}</Tx>
                </Pressable>
            </View>
        );
        if (floating) {
            return (
                <View style={{ paddingTop: 10, paddingHorizontal: 24 }}>
                    <View style={{ alignSelf: 'center', width: '100%', maxWidth: PAGE - 40, borderRadius: 34, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, boxShadow: '0 10px 30px rgba(0,0,0,0.14)' }}>{inner}</View>
                </View>
            );
        }
        return <View style={{ backgroundColor: T.surface, borderBottomWidth: 1, borderBottomColor: T.border }}>{inner}</View>;
    };

    const Dish = ({ d, kind }) => {
        const compact = kind === 'compact';
        const big = kind === 'big';
        return (
            <Pressable onPress={() => setScreen('item')} style={[card, { overflow: 'hidden', flexDirection: compact ? 'row' : 'column', padding: compact ? 12 : 0, alignItems: compact ? 'center' : 'stretch' }]}>
                <View style={{ height: compact ? 96 : big ? 190 : 140, width: compact ? 96 : undefined, borderRadius: compact ? R : 0, backgroundColor: T.wash, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: compact ? 44 : big ? 82 : 60 }}>{d.emoji}</Text>
                    {d.best ? <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: T.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}><Tx style={{ color: T.onAccent, fontSize: 10, fontWeight: '800' }}>BESTSELLER</Tx></View> : null}
                    {compact ? null : <View style={{ position: 'absolute', right: 8, top: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="heart-outline" size={16} color="#444" /></View>}
                </View>
                <View style={{ padding: compact ? 0 : 12, paddingLeft: compact ? 14 : 12, flex: compact ? 1 : undefined }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 13, height: 13, borderWidth: 1.5, borderColor: d.veg ? '#1E8E3E' : '#C0392B', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: d.veg ? '#1E8E3E' : '#C0392B' }} /></View>
                        <Tx style={{ color: T.text, fontWeight: '800', fontSize: 15, marginLeft: 6, flex: 1 }} numberOfLines={1}>{d.name}</Tx>
                    </View>
                    <Tx style={{ color: T.muted, fontSize: 12, marginTop: 4 }} numberOfLines={1}>★ {d.rating} · {d.mins} mins</Tx>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                        <Tx style={{ color: T.text, fontWeight: '800', fontSize: 16, flex: 1 }}>₹{d.price}{d.mrp > d.price ? <Tx style={{ color: T.muted, fontSize: 12, textDecorationLine: 'line-through', fontWeight: '500' }}>  ₹{d.mrp}</Tx> : null}</Tx>
                        <View style={{ paddingHorizontal: 18, height: 34, borderRadius: T.radius > 20 ? 17 : Math.min(T.radius, 12), backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}><Tx style={{ color: T.onPrimary, fontWeight: '800', fontSize: 13 }}>{C.labels.addButton}</Tx></View>
                    </View>
                </View>
            </Pressable>
        );
    };

    const Grid = ({ list }) => {
        const kind = C.cardStyle === 'compact' ? 'compact' : C.cardStyle === 'big' ? 'big' : 'small';
        const cols = kind === 'small' ? 4 : 3;
        return (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -8 }}>
                {list.map((d) => <View key={d.id} style={{ width: `${100 / cols}%`, padding: 8 }}><Dish d={d} kind={kind} /></View>)}
            </View>
        );
    };

    const Cats = () => {
        const style = C.brand.categoryStyle;
        const one = (c, i) => {
            const on = i === 0;
            if (style === 'pills') return <View key={c.id} style={{ paddingHorizontal: 18, height: 40, borderRadius: 20, backgroundColor: on ? T.primary : T.surface, borderWidth: 1, borderColor: on ? T.primary : T.border, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginRight: 10, marginBottom: 10 }}><Text style={{ fontSize: 16, marginRight: 6 }}>{c.emoji}</Text><Tx style={{ color: on ? T.onPrimary : T.text, fontWeight: '700', fontSize: 14 }}>{c.name}</Tx></View>;
            if (style === 'tiles') return <View key={c.id} style={{ width: 132, height: 92, borderRadius: R, backgroundColor: on ? T.primary : T.wash, alignItems: 'center', justifyContent: 'center', marginRight: 12, marginBottom: 12 }}><Text style={{ fontSize: 30 }}>{c.emoji}</Text><Tx style={{ color: on ? T.onPrimary : T.text, fontWeight: '800', fontSize: 13, marginTop: 4 }}>{c.name}</Tx></View>;
            return <View key={c.id} style={{ width: 104, alignItems: 'center', marginRight: 6, marginBottom: 10 }}><View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: T.wash, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 3 : 0, borderColor: T.primary }}><Text style={{ fontSize: 34 }}>{c.emoji}</Text></View><Tx style={{ color: T.text, fontWeight: '700', fontSize: 13, marginTop: 6 }}>{c.name}</Tx></View>;
        };
        return scroll
            ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>{CATEGORIES.map(one)}</ScrollView>
            : <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 }}>{CATEGORIES.map(one)}</View>;
    };

    const Location = () => {
        const v = C.brand.locationStyle;
        const inside = (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="storefront-outline" size={18} color={v === 'banner' ? T.onPrimary : T.primary} />
                <View style={{ marginLeft: 10, flex: 1 }}>
                    <Tx style={{ color: v === 'banner' ? T.onPrimary : T.text, fontWeight: '800', fontSize: 14 }}>{C.name}</Tx>
                    <Tx style={{ color: v === 'banner' ? alpha(T.onPrimary, 0.8) : T.muted, fontSize: 12 }} numberOfLines={1}>{C.address || 'Shop address'}</Tx>
                </View>
                <Ionicons name="navigate" size={18} color={v === 'banner' ? T.onPrimary : T.primary} />
            </View>
        );
        if (v === 'banner') return <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ borderRadius: R, padding: 14, marginBottom: 16 }}>{inside}</LinearGradient>;
        if (v === 'strip') return <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border, marginBottom: 16 }}>{inside}</View>;
        if (v === 'chip') return <View style={{ alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, backgroundColor: T.soft, marginBottom: 16, minWidth: 320 }}>{inside}</View>;
        return <View style={[card, { padding: 14, marginBottom: 16 }]}>{inside}</View>;
    };

    const Header = () => {
        const body = (
            <View>
                <Tx style={{ color: hero ? T.onPrimary : T.text, fontWeight: '800', fontSize: hero ? 34 : 24 }}>{C.name}</Tx>
                <Tx style={{ color: hero ? alpha(T.onPrimary, 0.85) : T.muted, fontSize: hero ? 16 : 14, marginTop: 4 }}>{C.tagline}</Tx>
                {C.open ? null : <Tx style={{ color: hero ? T.onPrimary : T.errorText, fontWeight: '700', marginTop: 8 }}>{C.labels.closed}</Tx>}
            </View>
        );
        const banner = (
            <View style={{ flexDirection: 'row', marginBottom: 18 }}>
                {BANNERS.map((b, i) => (
                    <LinearGradient key={b.title} colors={i % 2 ? [T.accent, mix(T.accent, '#000000', 0.2)] : grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, height: 130, borderRadius: R, padding: 20, marginRight: i < 2 ? 16 : 0, justifyContent: 'center' }}>
                        <Tx style={{ color: i % 2 ? T.onAccent : T.onPrimary, fontWeight: '800', fontSize: 22 }}>{b.title}</Tx>
                        <Tx style={{ color: i % 2 ? T.onAccent : alpha(T.onPrimary, 0.9), fontSize: 14, marginTop: 4 }}>{b.sub}</Tx>
                    </LinearGradient>
                ))}
            </View>
        );
        return (
            <View>
                {hero
                    ? <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: R + 6, padding: 28, marginTop: 16, marginBottom: 18 }}>{body}</LinearGradient>
                    : <View style={{ marginTop: 18, marginBottom: 14 }}>{body}</View>}
                {banner}
            </View>
        );
    };

    const Coupons = ({ wrap }) => (
        <View style={{ flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap', marginHorizontal: wrap ? -8 : 0 }}>
            {OFFERS.map((o) => (
                <View key={o.code} style={[card, { flexDirection: 'row', alignItems: 'center', padding: 14, marginRight: wrap ? 0 : 14, width: wrap ? '33.33%' : 300, margin: wrap ? 8 : 0, borderStyle: 'dashed' }]}>
                    <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: T.soft, alignItems: 'center', justifyContent: 'center' }}><Tx style={{ color: T.primary, fontWeight: '800', fontSize: 16 }}>{o.value}</Tx></View>
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Tx style={{ color: T.text, fontWeight: '800', fontSize: 15 }}>{o.code}</Tx>
                        <Tx style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>{o.desc}</Tx>
                        <Tx style={{ color: T.muted, fontSize: 11, marginTop: 2 }}>Min order ₹{o.min}</Tx>
                    </View>
                </View>
            ))}
        </View>
    );

    const H1 = ({ children }) => <Tx style={{ color: T.text, fontWeight: '800', fontSize: 24, marginTop: 22, marginBottom: 14 }}>{children}</Tx>;
    const Btn = ({ children, onPress, w }) => <Pressable onPress={onPress} style={{ height: 48, borderRadius: Math.min(T.radius, 24), backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center', width: w }}><Tx style={{ color: T.onPrimary, fontWeight: '800', fontSize: 15 }}>{children}</Tx></Pressable>;

    let body;
    if (screen === 'search') {
        body = (<View><H1>Search</H1><Cats /><Grid list={dishes} /></View>);
    } else if (screen === 'item') {
        const d = DISHES[0];
        body = (
            <View style={{ flexDirection: 'row', marginTop: 24 }}>
                <View style={{ flex: 1, height: 420, borderRadius: R + 6, backgroundColor: T.wash, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 190 }}>{d.emoji}</Text></View>
                <View style={{ flex: 1, paddingLeft: 36 }}>
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: 32 }}>{d.name}</Tx>
                    <Tx style={{ color: T.muted, fontSize: 14, marginTop: 6 }}>★ {d.rating} · {d.mins} mins</Tx>
                    <Tx style={{ color: T.text, fontSize: 15, lineHeight: 23, marginTop: 14 }}>{d.desc}</Tx>
                    {C.itemOptions.sizes ? (
                        <View style={{ flexDirection: 'row', marginTop: 20 }}>
                            {['Regular', 'Large'].map((x, i) => <View key={x} style={{ paddingHorizontal: 18, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: i ? T.border : T.primary, backgroundColor: i ? 'transparent' : T.soft, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}><Tx style={{ color: T.text, fontWeight: '700' }}>{x}</Tx></View>)}
                        </View>
                    ) : null}
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: 28, marginTop: 24 }}>₹{d.price}</Tx>
                    <View style={{ marginTop: 18, flexDirection: 'row' }}><Btn w={260} onPress={() => setScreen('cart')}>{C.labels.addButton} to cart</Btn></View>
                </View>
            </View>
        );
    } else if (screen === 'offers') {
        body = (<View><H1>Offers and coupons</H1><Coupons wrap /></View>);
    } else if (screen === 'cart') {
        const sub = cartLines.reduce((a, [d, n]) => a + d.price * n, 0);
        body = (
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <View style={{ flex: 1.5, paddingRight: 26 }}>
                    <H1>Your cart</H1>
                    {cartLines.map(([d, n]) => (
                        <View key={d.id} style={[card, { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 12 }]}>
                            <View style={{ width: 64, height: 64, borderRadius: R, backgroundColor: T.wash, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 32 }}>{d.emoji}</Text></View>
                            <View style={{ flex: 1, marginLeft: 14 }}><Tx style={{ color: T.text, fontWeight: '800', fontSize: 16 }}>{d.name}</Tx><Tx style={{ color: T.muted, fontSize: 13, marginTop: 2 }}>₹{d.price}</Tx></View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, borderColor: T.primary, height: 36, paddingHorizontal: 12 }}><Tx style={{ color: T.primary, fontWeight: '800' }}>−   {n}   +</Tx></View>
                        </View>
                    ))}
                </View>
                <View style={[card, { flex: 1, padding: 20, marginTop: 66, alignSelf: 'flex-start' }]}>
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: 18, marginBottom: 12 }}>Bill details</Tx>
                    {[['Item total', `₹${sub}`], ['Delivery', '₹40'], ['Taxes', `₹${Math.round(sub * 0.05)}`]].map(([a, b]) => <View key={a} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}><Tx style={{ color: T.muted }}>{a}</Tx><Tx style={{ color: T.text, fontWeight: '700' }}>{b}</Tx></View>)}
                    <View style={{ height: 1, backgroundColor: T.border, marginVertical: 8 }} />
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}><Tx style={{ color: T.text, fontWeight: '800', fontSize: 17 }}>To pay</Tx><Tx style={{ color: T.text, fontWeight: '800', fontSize: 17 }}>₹{sub + 40 + Math.round(sub * 0.05)}</Tx></View>
                    <Btn>{C.labels.orderButton}</Btn>
                </View>
            </View>
        );
    } else if (screen === 'orders') {
        const live = ORDERS.live;
        body = (
            <View>
                <H1>Your orders</H1>
                <View style={[card, { padding: 22, marginBottom: 16 }]}>
                    <Tx style={{ color: T.primary, fontWeight: '800', fontSize: 13 }}>LIVE · #{live.no}</Tx>
                    <Tx style={{ color: T.text, fontWeight: '700', fontSize: 15, marginTop: 4 }}>{live.items}</Tx>
                    <View style={{ flexDirection: 'row', marginTop: 18 }}>
                        {STEPS.map((s, i) => (
                            <View key={s} style={{ flex: 1, alignItems: 'center' }}>
                                <View style={{ height: 6, width: '100%', backgroundColor: i <= live.step ? T.primary : T.border, borderRadius: 3 }} />
                                <Tx style={{ color: i <= live.step ? T.text : T.muted, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{s}</Tx>
                            </View>
                        ))}
                    </View>
                </View>
                {ORDERS.past.map((o) => (
                    <View key={o.no} style={[card, { flexDirection: 'row', alignItems: 'center', padding: 18, marginBottom: 12 }]}>
                        <View style={{ flex: 1 }}><Tx style={{ color: T.text, fontWeight: '800', fontSize: 15 }}>#{o.no} · {o.status}</Tx><Tx style={{ color: T.muted, fontSize: 13, marginTop: 2 }}>{o.items} · {o.date}</Tx></View>
                        <Tx style={{ color: T.text, fontWeight: '800', fontSize: 16 }}>₹{o.total}</Tx>
                    </View>
                ))}
            </View>
        );
    } else if (screen === 'account') {
        body = (
            <View style={{ flexDirection: 'row', marginTop: 24 }}>
                <View style={[card, { width: 340, padding: 24, alignItems: 'center', alignSelf: 'flex-start' }]}>
                    <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: T.primary, alignItems: 'center', justifyContent: 'center' }}><Tx style={{ color: T.onPrimary, fontWeight: '800', fontSize: 34 }}>{USER.name.slice(0, 1)}</Tx></View>
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: 20, marginTop: 12 }}>{USER.name}</Tx>
                    <Tx style={{ color: T.muted, marginTop: 2 }}>{USER.phone}</Tx>
                </View>
                <View style={{ flex: 1, paddingLeft: 24 }}>
                    {[['location-outline', 'Saved addresses'], ['heart-outline', 'Favourites'], ['receipt-outline', 'My orders'], ['gift-outline', 'My points'], ['color-palette-outline', 'Appearance'], ['help-circle-outline', 'Help and support']].map(([ic, l]) => (
                        <View key={l} style={[card, { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 10 }]}>
                            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.soft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={19} color={T.primary} /></View>
                            <Tx style={{ color: T.text, fontWeight: '700', fontSize: 15, flex: 1, marginLeft: 14 }}>{l}</Tx>
                            <Ionicons name="chevron-forward" size={18} color={T.muted} />
                        </View>
                    ))}
                </View>
            </View>
        );
    } else {
        body = (
            <View>
                <Header />
                <Location />
                <Cats />
                {C.offers.enabled && C.offers.onHome ? <View style={{ marginBottom: 6 }}><Tx style={{ color: T.text, fontWeight: '800', fontSize: 22, marginBottom: 12 }}>Offers for you</Tx><Coupons /></View> : null}
                <H1>{C.grouped ? 'Biryani' : 'All dishes'}</H1>
                <Grid list={dishes} />
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: T.background }}>
            <TopBar />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
                <View style={{ width: '100%', maxWidth: PAGE, alignSelf: 'center', paddingHorizontal: 24 }}>{body}</View>
            </ScrollView>
            {screen === 'cart' ? null : (
                <Pressable onPress={() => setScreen('cart')} style={{ position: 'absolute', right: 28, bottom: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 54, borderRadius: 27, backgroundColor: T.primary, boxShadow: '0 10px 26px rgba(0,0,0,0.25)' }}>
                    <Ionicons name="bag-handle" size={20} color={T.onPrimary} />
                    <Tx style={{ color: T.onPrimary, fontWeight: '800', fontSize: 15, marginLeft: 10 }}>3 items · ₹{DISHES[0].price * 2 + DISHES[7].price}</Tx>
                </Pressable>
            )}
        </View>
    );
}

// the browser window: fake address bar and the site
function Window({ C, dark, fonts, screen, setScreen, scroll }) {
    const T = useMemo(() => tokens(C.brand, dark), [C, dark]);
    return (
        <View style={{ width: DW, height: DH, borderRadius: 12, overflow: 'hidden', backgroundColor: T.background, borderWidth: 1, borderColor: '#9AA0A6' }}>
            <View style={{ height: BAR, backgroundColor: dark ? '#2B2D31' : '#E8EAED', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 }}>
                {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => <View key={c} style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: c, marginRight: 7 }} />)}
                <View style={{ flex: 1, maxWidth: 620, marginLeft: 24, height: 24, borderRadius: 12, backgroundColor: dark ? '#1B1C1F' : '#FFFFFF', justifyContent: 'center', paddingHorizontal: 12 }}>
                    <Text style={{ color: dark ? '#C4C7CC' : '#5F6368', fontSize: 12 }} numberOfLines={1}>{`https://${(C.name || 'shop').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'shop'}.example.com`}</Text>
                </View>
            </View>
            <View style={{ height: DH - BAR }}>
                <Site C={C} T={T} fonts={fonts} screen={screen} setScreen={setScreen} scroll={scroll} />
            </View>
        </View>
    );
}

// the window scaled into a box of the given width (inner window placed in the middle of a DW x DH slot, then shrunk about its centre)
function Scaled({ scale, children }) {
    return (
        <View style={{ width: DW * scale, height: DH * scale, overflow: 'hidden', alignSelf: 'center' }}>
            <View style={{ position: 'absolute', left: (DW * scale - DW) / 2, top: (DH * scale - DH) / 2, width: DW, height: DH, transform: [{ scale }] }}>{children}</View>
        </View>
    );
}

export default function DesktopPreview({ config }) {
    const t = useTheme();
    const { width: sw, height: sh } = useWindowDimensions();
    const [dark, setDark] = useState(false);
    const [screen, setScreen] = useState('home');
    const [full, setFull] = useState(false);
    const [boxW, setBoxW] = useState(0);
    const [fonts] = useFonts(FONT_MAP);
    const dc = useMemo(() => desktopConfig(config), [config]);
    const C = useMemo(() => normalize(dc), [dc]);
    const scroll = dc.__scroll === true;
    const follow = (config?.brand?.desktop || {}).follow !== false;
    const scale = boxW ? Math.min(boxW / DW, 1) : 0.25;
    // full screen: the window is turned 90 degrees so it fills a phone that is held upright
    const fs = Math.min((sw - 12) / DH, (sh - 90) / DW);

    const pick = (setter) => (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginVertical: 6 }}>
            {SCREENS.map(([k, label]) => (
                <Pressable key={k} onPress={() => setter(k)} style={{ borderRadius: 14, borderWidth: 1, borderColor: screen === k ? t.primary : t.border, backgroundColor: screen === k ? t.primarySoft : t.surface, paddingHorizontal: 11, paddingVertical: 6, marginRight: 6 }}>
                    <Text style={{ color: screen === k ? t.primary : t.text, fontSize: font.xs, fontWeight: '800' }}>{label}</Text>
                </Pressable>
            ))}
        </ScrollView>
    );
    const darkBtn = (light) => (
        <Pressable onPress={() => setDark((d) => !d)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: light ? 'rgba(255,255,255,0.4)' : dark ? t.primary : t.border, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 }}>
            <Ionicons name={dark ? 'moon' : 'moon-outline'} size={13} color={light ? '#FFFFFF' : dark ? t.primary : t.muted} />
            <Text style={{ color: light ? '#FFFFFF' : dark ? t.primary : t.muted, fontSize: font.xs, fontWeight: '800', marginLeft: 4 }}>Dark</Text>
        </Pressable>
    );

    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }}>Website on a computer</Text>
                    <Text style={{ color: t.muted, fontSize: font.xs }}>{follow ? 'Same look as the mobile app.' : 'The desktop website\'s own look.'}</Text>
                </View>
                {darkBtn(false)}
                <Pressable onPress={() => setFull(true)} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: t.primary, paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Ionicons name="phone-landscape-outline" size={13} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontSize: font.xs, fontWeight: '800', marginLeft: 4 }}>Full screen</Text>
                </Pressable>
            </View>
            {pick(setScreen)}
            <View onLayout={(e) => setBoxW(Math.round(e.nativeEvent.layout.width))} style={{ width: '100%' }}>
                {boxW ? <Scaled scale={scale}><Window C={C} dark={dark} fonts={fonts} screen={screen} setScreen={setScreen} scroll={scroll} /></Scaled> : <View style={{ height: 200 }} />}
            </View>

            <Modal visible={full} animationType="fade" transparent onRequestClose={() => setFull(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', paddingTop: 36 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }}>
                        <Text style={{ flex: 1, color: '#FFFFFF', fontSize: font.md, fontWeight: '800' }}>{C.name} on a computer</Text>
                        {darkBtn(true)}
                        <Pressable onPress={() => setFull(false)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={20} color="#FFFFFF" /></Pressable>
                    </View>
                    <View style={{ paddingHorizontal: 12 }}>{pick(setScreen)}</View>
                    <View style={{ flex: 1 }}>
                        <View style={{ position: 'absolute', left: (sw - DW) / 2, top: ((sh - 130) - DH) / 2, width: DW, height: DH, transform: [{ rotate: '90deg' }, { scale: fs }] }}>
                            <Window C={C} dark={dark} fonts={fonts} screen={screen} setScreen={setScreen} scroll={scroll} />
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
