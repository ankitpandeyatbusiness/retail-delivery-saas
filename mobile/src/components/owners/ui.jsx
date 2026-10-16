// The owner panel's building blocks. Everything draws from useBrand(), so the panel wears the shop's own logo,
// colours, font and light/dark look: the owner feels he is on his own app.
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { setAcceptingOrders, apiError } from '../../api/owners/shopApi';
import { ask } from '../common/dialog';
import { showToast } from '../customers/shop';

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
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 14 }}>{label}</Text>
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
export function Button({ label, onPress, icon, kind = 'primary', busy, working, disabled, style }) {
    const { primary, onPrimary, text, border, error, radius } = useBrand();
    const fill = kind === 'primary' ? primary : kind === 'danger' ? error : 'transparent';
    const ink = kind === 'primary' ? onPrimary : kind === 'danger' ? '#FFFFFF' : text;
    const ripple = kind === 'ghost' ? alpha(text, 0.18) : alpha(ink, 0.35);
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || busy}
            android_ripple={{ color: ripple, borderless: false, foreground: true }}
            style={({ pressed }) => [
                s.btn,
                {
                    backgroundColor: fill, borderRadius: radius, borderColor: kind === 'ghost' ? border : fill, overflow: 'hidden',
                    opacity: disabled ? 0.45 : pressed ? 0.72 : 1,
                    transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
                },
                kind === 'ghost' && pressed && { backgroundColor: alpha(text, 0.1) },
                style,
            ]}
        >
            {busy ? <ActivityIndicator color={ink} size="small" /> : (
                <>
                    {working ? <ActivityIndicator color={ink} size="small" style={{ marginRight: 10 }} /> : (icon ? <Ionicons name={icon} size={18} color={ink} style={{ marginRight: 8 }} /> : null)}
                    <Text numberOfLines={1} style={{ color: ink, fontWeight: '800', fontSize: 15, flexShrink: 1 }}>{label}</Text>
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
function ShopLogo({ size = 40 }) {
    const { primary, onPrimary, border } = useBrand();
    const theme = useThemeStore((st) => st.theme);
    const initial = String(theme.name || '?').trim().charAt(0).toUpperCase();
    return theme.logo ? (
        <Image source={{ uri: theme.logo }} style={{ width: size, height: size, borderRadius: size / 3, borderWidth: StyleSheet.hairlineWidth, borderColor: border }} contentFit="cover" />
    ) : (
        <View style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: onPrimary, fontWeight: '900', fontSize: size * 0.45 }}>{initial}</Text>
        </View>
    );
}

// The shop's logo opens the Shop hub; the switch pauses / resumes taking orders.
export function OwnerHeader({ title }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { text, muted, background, ok, error } = useBrand();
    const name = useThemeStore((st) => st.theme.name);
    const unread = useNotificationStore((st) => st.unread);
    const restaurant = useHomeStore((st) => st.full.restaurant);
    const accepting = useHomeStore((st) => st.full.orders.acceptingOrders);
    const access = useOwnerStore((st) => st.access);

    const open = restaurant?.isOpen !== false && accepting !== false;
    const label = accepting === false ? 'Orders paused' : restaurant?.isOpen === false ? 'Closed now' : 'Open';
    const canToggle = access === 'ok';

    const toggle = async () => {
        if (!canToggle) return;
        const pausing = accepting !== false;
        const yes = await ask({
            title: pausing ? 'Pause new orders?' : 'Start taking orders?',
            message: pausing ? 'Customers will see that the shop is not taking orders until you start again.' : 'Customers will be able to order again.',
            confirmText: pausing ? 'Pause' : 'Start',
            destructive: pausing,
        });
        if (!yes) return;
        try {
            await setAcceptingOrders(!pausing);
            await useHomeStore.getState().load();
            showToast(pausing ? 'Orders paused' : 'Taking orders');
        } catch (e) {
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
        }
    };

    return (
        <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: background }]}>
            <Pressable onPress={() => nav.navigate('ShopHub')} hitSlop={8}><ShopLogo /></Pressable>
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: text, fontSize: 18, fontWeight: '900' }} numberOfLines={1}>{title || name}</Text>
                <Pressable onPress={toggle} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: open ? ok : error, marginRight: 6 }} />
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{label}{canToggle ? ' · tap to change' : ''}</Text>
                </Pressable>
            </View>
            <Pressable onPress={() => nav.navigate('ShopHub')} hitSlop={10} style={{ padding: 6 }}>
                <Ionicons name="notifications-outline" size={24} color={text} />
                {unread > 0 ? <View style={[s.dot, { backgroundColor: error }]} /> : null}
            </Pressable>
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
                    <Text style={{ color: error, fontWeight: '900' }}>{blocked ? 'Your shop panel is paused' : 'Rent is unpaid'}</Text>
                    <Text style={{ color: error, opacity: 0.85, fontSize: 12, marginTop: 2 }}>
                        {blocked
                            ? 'Please contact support. You can still finish orders that are in progress.'
                            : `Menu and settings are locked until it is paid.${due} Orders, riders and money still work.`}
                    </Text>
                </View>
            </View>
            {!blocked ? <Button label="Pay rent" kind="primary" onPress={() => nav.navigate('MoneyTab')} style={{ marginTop: 10 }} /> : null}
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
    option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 32 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
    dot: { position: 'absolute', top: 5, right: 6, width: 10, height: 10, borderRadius: 5 },
});
