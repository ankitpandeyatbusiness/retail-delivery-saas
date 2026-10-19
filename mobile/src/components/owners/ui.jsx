// The owner panel's building blocks. Everything draws from useBrand(), so the panel wears the shop's own logo,
// colours, font and light/dark look: the owner feels he is on his own app.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView, Platform, Animated, Easing } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useDrawer } from '../../store/owners/useDrawer';
import { setAcceptingOrders, apiError } from '../../api/owners/shopApi';
import { clockTime } from '../../utils/owners/orderFlow';
import { showToast } from '../customers/shop';
import { LineShimmer } from './shimmer';
import { tr } from '../../i18n';
import KeyboardScroll from '../common/KeyboardScroll';

export const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/* ------------------------------ surfaces ------------------------------ */
export function Card({ children, style, onPress, tone }) {
    const { surface, border, primary } = useBrand();
    const base = [s.card, { backgroundColor: surface, borderColor: tone ? alpha(tone === true ? primary : tone, 0.35) : border }, style];
    if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => [...base, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
    return <View style={base}>{children}</View>;
}

export function SectionTitle({ title, action, onAction }) {
    const { text, primary } = useBrand();
    return (
        <View style={s.sectionRow}>
            <Text style={[s.sectionTitle, { color: text }]}>{title}</Text>
            {action ? <Pressable onPress={onAction} hitSlop={10}><Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{action}</Text></Pressable> : null}
        </View>
    );
}

export function Pill({ label, color, icon }) {
    const { primary } = useBrand();
    const c = color || primary;
    return (
        <View style={[s.pill, { backgroundColor: alpha(c, 0.14) }]}>
            {icon ? <Ionicons name={icon} size={12} color={c} style={{ marginRight: 4 }} /> : null}
            <Text numberOfLines={1} style={{ color: c, fontSize: 12, fontWeight: '800', flexShrink: 1 }}>{label}</Text>
        </View>
    );
}

// Choose one of a few short options. The chips wrap onto a second line when they do not fit, and a long label shrinks
// instead of touching the edges.   options: [[value, label], ...]
export function Chips({ options, value, onChange, style }) {
    const { primary, onPrimary, text, border } = useBrand();
    return (
        <View style={[{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginRight: -8 }, style]}>
            {options.map(([v, label]) => {
                const on = v === value;
                return (
                    <Pressable
                        key={String(v)}
                        onPress={() => onChange(v)}
                        style={{
                            flexGrow: 1, minWidth: 76, marginRight: 8, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 11,
                            borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
                            borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent',
                        }}
                    >
                        <Text numberOfLines={1} style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

// One choice in a list ("which voice", "which greeting"): a small radio, the name, a note under it, an optional badge.
export function Option({ selected, title, subtitle, badge, onPress, last }) {
    const { text, muted, border, primary } = useBrand();
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [s.option, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }, pressed && { opacity: 0.7 }]}
        >
            <View style={[s.radio, { borderColor: selected ? primary : muted }]}>
                {selected ? <View style={[s.radioDot, { backgroundColor: primary }]} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 15, marginRight: 8, flexShrink: 1 }}>{title}</Text>
                    {badge}
                </View>
                {subtitle ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
        </Pressable>
    );
}

// a number with a label: Today's sales, Orders, ...
export function Stat({ label, value, hint, color }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ flex: 1 }}>
            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{label}</Text>
            <Text style={{ color: color || text, fontSize: 22, fontWeight: '900', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
            {hint ? <Text style={{ color: muted, fontSize: 11, marginTop: 1 }}>{hint}</Text> : null}
        </View>
    );
}

// kind: primary | danger | ghost.   busy = a spinner only.   working = a spinner next to the label ("Playing…").
// Pressing shows at once: the button shrinks a little, darkens and ripples, so a tap is never in doubt.
export function Button({ label, onPress, icon, kind = 'primary', busy, working, disabled, style, iconOnly }) {
    const { primary, onPrimary, text, border, error, radius } = useBrand();
    const fill = kind === 'primary' ? primary : kind === 'danger' ? error : 'transparent';
    const ink = kind === 'primary' ? onPrimary : kind === 'danger' ? '#FFFFFF' : text;
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || busy}
            accessibilityRole="button" accessibilityLabel={iconOnly ? label : undefined}
            style={({ pressed }) => [
                s.btn,
                {
                    paddingHorizontal: 0, backgroundColor: fill, borderRadius: radius, borderColor: kind === 'ghost' ? border : fill,
                    opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
                },
                kind === 'ghost' && pressed && { backgroundColor: alpha(text, 0.1) },
                style,
            ]}
        >
            {busy ? <ActivityIndicator color={ink} size="small" /> : iconOnly && icon ? (
                <Ionicons name={icon} size={22} color={ink} style={{ flexGrow: 1, alignSelf: 'stretch', textAlign: 'center', textAlignVertical: 'center', paddingVertical: 13 }} />
            ) : (
                <>
                    {/* Only things with real content (text, icons) take touches on some phones, never the empty part of a button.
                        So the label, and an icon on each side, together cover the button from edge to edge (the right icon is invisible). */}
                    {working ? (
                        <View style={{ alignSelf: 'stretch', justifyContent: 'center', paddingLeft: 18, paddingRight: 8 }}><ActivityIndicator color={ink} size="small" /></View>
                    ) : icon ? (
                        <Ionicons name={icon} size={18} color={ink} style={{ alignSelf: 'stretch', textAlignVertical: 'center', paddingLeft: 18, paddingRight: 8, paddingVertical: 15 }} />
                    ) : null}
                    <Text numberOfLines={1} style={{ flexGrow: 1, flexShrink: 1, alignSelf: 'stretch', textAlign: 'center', textAlignVertical: 'center', color: ink, fontWeight: '800', fontSize: 15, paddingVertical: 14, paddingLeft: working || icon ? 0 : 18, paddingRight: working || icon ? 0 : 18 }}>{label}</Text>
                    {working || icon ? <Ionicons name={icon || 'ellipse'} size={18} color={ink} style={{ opacity: 0, alignSelf: 'stretch', textAlignVertical: 'center', paddingLeft: 8, paddingRight: 18, paddingVertical: 15 }} /> : null}
                </>
            )}
        </Pressable>
    );
}

// a tappable row: icon, title, subtitle, chevron
export function Row({ icon, title, subtitle, onPress, right, color, last }) {
    const { text, muted, border, primary } = useBrand();
    const c = color || primary;
    return (
        <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }, pressed && { opacity: 0.7 }]}>
            {icon ? <View style={[s.rowIcon, { backgroundColor: alpha(c, 0.14) }]}><Ionicons name={icon} size={20} color={c} /></View> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
                {subtitle ? <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{subtitle}</Text> : null}
            </View>
            {right ? <View style={{ marginLeft: 8, flexShrink: 0 }}>{right}</View> : (onPress ? <Ionicons name="chevron-forward" size={18} color={muted} style={{ marginLeft: 8 }} /> : null)}
        </Pressable>
    );
}

export function Empty({ icon = 'file-tray-outline', title, hint }) {
    const { text, muted } = useBrand();
    return (
        <View style={s.empty}>
            <Ionicons name={icon} size={44} color={muted} />
            <Text style={{ color: text, fontWeight: '800', fontSize: 16, marginTop: 10 }}>{title}</Text>
            {hint ? <Text style={{ color: muted, textAlign: 'center', marginTop: 4, maxWidth: 280 }}>{hint}</Text> : null}
        </View>
    );
}

/* ------------------------------ header ------------------------------ */
export function ShopLogo({ size = 40 }) {
    const { primary, onPrimary, border } = useBrand();
    const logo = useHomeStore((st) => st.full.restaurant?.logo);
    const shopName = useHomeStore((st) => st.full.restaurant?.name);
    const themeName = useThemeStore((st) => st.theme.name);
    const name = shopName || themeName;
    const [broken, setBroken] = useState(false);
    const initial = String(name || '?').trim().charAt(0).toUpperCase();
    return logo && !broken ? (
        <Image source={{ uri: logo }} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: size / 3, borderWidth: StyleSheet.hairlineWidth, borderColor: border, backgroundColor: '#FFFFFF' }} contentFit="contain" />
    ) : (
        <View style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: onPrimary, fontWeight: '900', fontSize: size * 0.45 }}>{initial}</Text>
        </View>
    );
}

// The big Live switch: ON = the shop takes orders, OFF = paused. Turning it OFF asks for how long (the pause sheet); turning it
// ON starts at once. The knob slides and the track changes colour.
export function LiveToggle({ on, busy, onPress }) {
    const { ok, error } = useBrand();
    const v = useRef(new Animated.Value(on ? 1 : 0)).current;
    // a soft spring on the UI thread: nothing here waits for JavaScript while the knob moves
    useEffect(() => {
        Animated.spring(v, { toValue: on ? 1 : 0, friction: 9, tension: 110, useNativeDriver: true }).start();
    }, [on, v]);
    const W = 74; const H = 36; const K = 28;
    return (
        <Pressable onPress={onPress} disabled={busy} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={on ? tr('Shop is live. Tap to pause orders') : tr('Shop is off. Tap to go live')} style={{ marginRight: 4 }}>
            <View style={{ width: W, height: H, borderRadius: H / 2, backgroundColor: alpha(error, 0.9), overflow: 'hidden', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } }}>
                {/* the green track fades in over the red one */}
                <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: ok, opacity: v }} />
                <Animated.Text style={{ position: 'absolute', left: 11, color: '#FFFFFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.8, opacity: v }}>{tr('LIVE')}</Animated.Text>
                <Animated.Text style={{ position: 'absolute', right: 11, color: '#FFFFFF', fontWeight: '900', fontSize: 11, letterSpacing: 0.8, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>{tr('OFF')}</Animated.Text>
                <Animated.View style={{ position: 'absolute', width: K, height: K, borderRadius: K / 2, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [4, W - K - 4] }) }] }}>
                    {busy ? <LineShimmer width={14} height={14} /> : (
                        <>
                            <Animated.View style={{ position: 'absolute', opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Ionicons name="power" size={15} color={error} /></Animated.View>
                            <Animated.View style={{ position: 'absolute', opacity: v }}><Ionicons name="power" size={15} color={ok} /></Animated.View>
                        </>
                    )}
                </Animated.View>
            </View>
        </Pressable>
    );
}

// The shop's logo opens the Shop hub; the switch pauses / resumes taking orders.
export function OwnerHeader({ title }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { text, muted, background, ok, error } = useBrand();
    const shopName = useHomeStore((st) => st.full.restaurant?.name);
    const themeName = useThemeStore((st) => st.theme.name);
    const name = shopName || themeName;
    const unread = useOwnerStore((st) => st.unread);
    const restaurant = useHomeStore((st) => st.full.restaurant);
    const accepting = useHomeStore((st) => st.full.orders.acceptingOrders);
    const access = useOwnerStore((st) => st.access);

    const pausedUntil = useHomeStore((st) => st.full.orders.pausedUntil);
    const [pauseOpen, setPauseOpen] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [pending, setPending] = useState(null);   // what the switch shows right now, before the server has answered

    const timedPause = !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();
    const open = restaurant?.isOpen !== false && accepting !== false;
    const label = timedPause ? `Paused until ${clockTime(pausedUntil)}`
        : accepting === false ? 'Orders paused'
            : restaurant?.isOpen === false ? 'Closed now' : 'Open';
    const canToggle = access === 'ok';
    const storeOn = accepting !== false;
    useEffect(() => { setPending(null); }, [storeOn]);   // the server's answer has arrived
    const isOn = pending ?? storeOn;

    // ON -> ask for how long (30 min ... until I start again). OFF -> go live at once.
    const flip = async () => {
        if (!canToggle) { showToast(access === 'blocked' ? tr('Your shop panel is paused by the platform') : tr('Locked while the monthly bill is unpaid')); return; }
        if (isOn) { setPauseOpen(true); return; }
        setPending(true);
        setSwitching(true);
        try {
            await setAcceptingOrders(true);
            await useHomeStore.getState().load();
            useOwnerStore.getState().refresh();
            showToast(tr('You are live. Customers can order.'));
        } catch (e) { setPending(null); useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSwitching(false); }
    };

    return (
        <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: background }]}>
            <Pressable onPress={() => useDrawer.getState().show()} hitSlop={10} style={{ paddingRight: 12 }} accessibilityLabel={tr('Open the menu')}><Ionicons name="menu" size={26} color={text} /></Pressable>
            <ShopLogo />
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: text, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>{title || name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: open ? ok : error, marginRight: 6 }} />
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{label}</Text>
                </View>
            </View>
            <LiveToggle on={isOn} busy={switching} onPress={flip} />
            <Pressable onPress={() => nav.navigate('OwnerNotifications')} hitSlop={10} style={{ padding: 6 }}>
                <Ionicons name="notifications-outline" size={24} color={text} />
                {unread > 0 ? <View style={[s.dot, { backgroundColor: error }]} /> : null}
            </Pressable>
            <PauseSheet visible={pauseOpen} onClose={() => setPauseOpen(false)} onPending={setPending} />
        </View>
    );
}

/* ------------------------------ access banner ------------------------------ */
// Says plainly what is switched off and why, instead of letting buttons fail one by one.
export function AccessBanner() {
    const nav = useNavigation();
    const { error } = useBrand();
    const access = useOwnerStore((st) => st.access);
    const billing = useOwnerStore((st) => st.billing);
    if (access === 'ok') return null;
    const blocked = access === 'blocked';
    const due = billing?.due?.amount ? ` ${money(billing.due.amount)} is due.` : '';
    return (
        <Card tone={error} style={{ marginHorizontal: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name={blocked ? 'lock-closed' : 'alert-circle'} size={22} color={error} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: error, fontWeight: '900' }}>{blocked ? tr('Your shop panel is paused') : tr('Rent is unpaid')}</Text>
                    <Text style={{ color: error, opacity: 0.85, fontSize: 12, marginTop: 2 }}>
                        {blocked
                            ? tr('Please contact support. You can still finish orders that are in progress.')
                            : tr('Menu and settings are locked until it is paid.{due} Orders, riders and money still work.', { due: due })}
                    </Text>
                </View>
            </View>
            {!blocked ? <Button label={tr('Pay rent')} kind="primary" onPress={() => nav.navigate('MainTabs', { screen: 'MoneyTab' })} style={{ marginTop: 10 }} /> : null}
        </Card>
    );
}

/* ------------------------------ screen frame ------------------------------ */
// Header + banner + pull to refresh, for the five tab screens.
export function OwnerScreen({ title, children, onRefresh, refreshing, scroll = true }) {
    const { background, primary } = useBrand();
    const body = scroll ? (
        <ScrollView
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={primary} colors={[primary]} /> : undefined}
        >
            <AccessBanner />
            {children}
        </ScrollView>
    ) : (<><AccessBanner />{children}</>);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <OwnerHeader title={title} />
            {body}
        </View>
    );
}

// A page that is opened from a tab (back arrow + title), for detail screens.
export function PageHeader({ title, right }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { text, background } = useBrand();
    return (
        <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: background }]}>
            <Pressable onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={12} style={{ paddingRight: 14 }}>
                <Ionicons name="arrow-back" size={24} color={text} />
            </Pressable>
            <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>{title}</Text>
            {right}
        </View>
    );
}

const s = StyleSheet.create({
    card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginHorizontal: 16, marginBottom: 12 },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 6, marginBottom: 10 },
    sectionTitle: { fontSize: 16, fontWeight: '900' },
    pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, alignSelf: 'flex-start' },
    btn: { minHeight: 48, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingHorizontal: 16, maxHeight: '90%', elevation: 24, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: -6 } },
    option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 32 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
    dot: { position: 'absolute', top: 5, right: 6, width: 10, height: 10, borderRadius: 5 },
});

/* ------------------------------ sheet and fields ------------------------------ */
// A panel that slides up from the bottom. Tapping the dark area or the back button closes it.
export function Sheet({ visible, onClose, title, children }) {
    const { surface, text, border, muted } = useBrand();
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={[s.sheet, { backgroundColor: surface, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
                    <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: border, marginBottom: 10 }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '900' }}>{title}</Text>
                        <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={muted} /></Pressable>
                    </View>
                    <KeyboardScroll keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</KeyboardScroll>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

// a text box: for a reason the owner types himself
export function Field({ value, onChangeText, placeholder, multiline, maxLength = 200, autoFocus, style, keyboardType }) {
    const { text, muted, border, surface } = useBrand();
    return (
        <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={muted}
            multiline={multiline}
            maxLength={maxLength}
            autoFocus={autoFocus}
            keyboardType={keyboardType}
            style={[{
                borderWidth: 1, borderColor: border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: text, fontSize: 15,
                backgroundColor: surface, minHeight: multiline ? 84 : 46, textAlignVertical: multiline ? 'top' : 'center',
            }, style]}
        />
    );
}

/* ------------------------------ pause orders ------------------------------ */
const PAUSE_CHOICES = [
    ['30 minutes', { pauseMinutes: 30 }, 'time-outline'],
    ['1 hour', { pauseMinutes: 60 }, 'time-outline'],
    ['2 hours', { pauseMinutes: 120 }, 'time-outline'],
    ['Until tomorrow morning', { untilMorning: true }, 'moon-outline'],
    ['Until I start again', {}, 'hand-left-outline'],
];

// Stop taking orders for a while, or start again. A timed pause reopens the shop BY ITSELF, so a forgotten pause cannot
// lose a day of sales.
export function PauseSheet({ visible, onClose, onPending }) {
    const { muted, error } = useBrand();
    const accepting = useHomeStore((st) => st.full.orders.acceptingOrders);
    const pausedUntil = useHomeStore((st) => st.full.orders.pausedUntil);
    const [busy, setBusy] = useState(false);
    const paused = accepting === false;

    const apply = async (acceptingOrders, extra) => {
        setBusy(true);
        if (onPending) onPending(acceptingOrders);   // the header switch starts moving at once
        try {
            await setAcceptingOrders(acceptingOrders, extra);
            await useHomeStore.getState().load();
            useOwnerStore.getState().refresh();
            showToast(acceptingOrders ? tr('Taking orders again') : tr('Orders paused'));
            onClose();
        } catch (e) {
            if (onPending) onPending(null);
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
        } finally { setBusy(false); }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title={paused ? tr('Orders are paused') : tr('Pause new orders')}>
            {paused ? (
                <View>
                    <Text style={{ color: muted, marginBottom: 14 }}>
                        {pausedUntil ? tr('Customers can not order until {clockTime}, then the shop opens by itself.', { clockTime: clockTime(pausedUntil) }) : tr('Customers can not order until you start again.')}
                    </Text>
                    <Button label={tr('Start taking orders now')} icon="play" busy={busy} onPress={() => apply(true)} />
                </View>
            ) : (
                <View>
                    <Text style={{ color: muted, marginBottom: 8 }}>{tr('Customers will see that the shop is not taking orders. Orders already placed are not affected.')}</Text>
                    {PAUSE_CHOICES.map(([label, extra, icon], i) => (
                        <Row key={label} icon={icon} title={label} color={i === PAUSE_CHOICES.length - 1 ? error : undefined} onPress={busy ? undefined : () => apply(false, extra)} last={i === PAUSE_CHOICES.length - 1} />
                    ))}
                    {busy ? <LineShimmer width={120} height={14} /> : null}
                </View>
            )}
        </Sheet>
    );
}
