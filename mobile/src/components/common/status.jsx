// src/ui/status.jsx
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ActivityIndicator } from './Loading';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import { useAppStatus } from '../../store/common/useAppStatus';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useMenuStore } from '../../store/customers/shopStores';
import { fetchConfig } from '../../api/customers/catalogApi';
import { fetchClosure } from '../../api/owners/shopApi';
import { onShopChanged } from '../../api/common/socket';
import { tr } from '../../i18n';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (v) => {
    const d = new Date(v);
    const h = d.getHours();
    return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// any call that works clears the frozen / offline state (see client.js)
// A call that works clears the frozen state; a 402 / 503 sets it again (see client.js). Safe to call at any time.
const reloadShop = async () => {
    try { await fetchConfig(); useAppStatus.getState().clearFrozen(); } catch (e) { /* client.js notes a closed shop or a lost connection */ }
    await Promise.allSettled([useHomeStore.getState().load(), useMenuStore.getState().load()]);
};

// What a closed / paused shop looks like: the app stays visible but dimmed behind ONE message card. Nothing underneath can be touched.
// The wording depends on who is looking: a customer is told the shop is closed or back soon; staff and riders are told to contact the owner.
export function FrozenOverlay({ onOrders, routeName, onRent }) {
    const frozen = useAppStatus((st) => st.frozen);
    const user = useAuthStore((st) => st.user);
    const shop = useThemeStore((st) => st.theme.name);
    const { primary, radius, text, background, muted } = useBrand();
    const insets = useSafeAreaInsets();
    const [busy, setBusy] = useState(false);

    // told live when the shop changes, and (while it is closed) asked again every 20 seconds: this also catches a maintenance that ends by its end time
    useEffect(() => onShopChanged(() => { reloadShop(); }), []);
    useEffect(() => {
        if (!frozen) return undefined;
        const t = setInterval(reloadShop, 20000);
        return () => clearInterval(t);
    }, [frozen]);

    // the owner of a shop closed for rent: what is owed, and a way to the Rent page (the overlay steps aside while he is on it)
    const isOwner = user?.role === 'admin';
    const [why, setWhy] = useState(null);
    useEffect(() => {
        if (!frozen || !isOwner || frozen.status === 503 || frozen.maintenance) { setWhy(null); return; }
        fetchClosure().then(setWhy).catch(() => setWhy(null));
    }, [frozen, isOwner]);

    if (!frozen) return null;
    if (isOwner && routeName === 'OwnerRent') return null;

    const role = user?.role || 'customer';
    const staff = role === 'kitchen' || role === 'waiter' || role === 'rider';
    const maint = frozen.status === 503 || frozen.maintenance;
    const until = frozen.until && !Number.isNaN(new Date(frozen.until).getTime()) ? fmt(frozen.until) : '';
    const title = maint ? tr('Back soon') : tr(role === 'customer' ? 'Closed for now' : 'Shop is closed');
    const msg = staff
        ? (maint ? (frozen.message || tr('We are down for maintenance. Please try again soon.')) : tr('The shop is closed. Please contact the owner.'))
        : isOwner && why?.closed && !maint
            ? (why.kind === 'rent' ? tr('Your shop is closed because rent is unpaid. It opens again by itself when you pay.') : tr('Your shop was closed by the platform team. Please contact support.'))
        : (frozen.message || (maint ? tr('We are down for maintenance. Please try again soon.') : tr('This shop is not accepting orders right now')));

    const retry = async () => {
        setBusy(true);
        try { await reloadShop(); } finally { setBusy(false); }
    };
    // the app behind shows through (dimmed); a plain colour when the brand colour is not a simple #RRGGBB
    const dim = /^#[0-9a-fA-F]{6}$/.test(background || '') ? background + 'F0' : background;

    return (
        <View style={[s.full, { backgroundColor: dim, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <Text style={[s.shop, { color: muted }]}>{shop}</Text>
            <View style={s.body}>
                <View style={[s.card, { backgroundColor: background, borderColor: muted + '33', borderRadius: radius + 8 }]}>
                    <Text style={s.emoji}>{maint ? '🛠' : '🔒'}</Text>
                    <Text style={[s.title, { color: text }]}>{title}</Text>
                    <Text style={[s.msg, { color: muted }]}>{msg}</Text>
                    {maint && until ? <Text style={[s.until, { color: muted }]}>{tr('Expected back by {until}', { until: until })}</Text> : null}

                    {isOwner && why?.closed && why.kind === 'rent' && why.owed?.total > 0 ? <Text style={[s.owed, { color: text }]}>{tr('Rent due')}: ₹{why.owed.total}</Text> : null}
                    {isOwner && why?.closed && onRent ? (
                        <Pressable onPress={onRent} style={[s.solid, { backgroundColor: primary, borderRadius: radius }]}>
                            <Text style={s.solidTxt}>{tr('Open Rent page')}</Text>
                        </Pressable>
                    ) : null}
                    <Pressable onPress={retry} disabled={busy} style={[s.solid, { backgroundColor: primary, borderRadius: radius }]}>
                        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.solidTxt}>{tr('Try again')}</Text>}
                    </Pressable>
                    {user && role === 'customer' ? (
                        <Pressable onPress={onOrders} style={[s.ghost, { borderColor: primary, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: primary }]}>{tr('My orders')}</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

export function OfflineBanner() {
    const offline = useAppStatus((st) => st.offline);
    const insets = useSafeAreaInsets();

    // keep trying quietly; the banner hides by itself when a call works
    useEffect(() => {
        if (!offline) return undefined;
        const t = setInterval(reloadShop, 15000);
        return () => clearInterval(t);
    }, [offline]);

    if (!offline) return null;
    return (
        <View style={[s.off, { paddingTop: insets.top + 4 }]}>
            <Text style={s.offTxt}>{tr('You are offline. Showing saved data.')}</Text>
            <Pressable onPress={reloadShop} hitSlop={8}><Text numberOfLines={1} style={s.offBtn}>{tr('Retry')}</Text></Pressable>
        </View>
    );
}

const s = StyleSheet.create({
    full: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50 },
    shop: { textAlign: 'center', fontSize: 15, fontWeight: '800', color: '#777777', paddingTop: 16 },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    card: { alignSelf: 'stretch', alignItems: 'center', borderWidth: 1, paddingHorizontal: 24, paddingVertical: 28, shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
    emoji: { fontSize: 56 },
    title: { fontSize: 22, fontWeight: '800', marginTop: 14 },
    msg: { fontSize: 14, color: '#666666', textAlign: 'center', marginTop: 8, lineHeight: 20 },
    owed: { fontSize: 18, fontWeight: '800', marginTop: 14 },
    until: { fontSize: 12, color: '#777777', marginTop: 10 },
    solid: { alignSelf: 'stretch', marginTop: 28, paddingVertical: 14, alignItems: 'center' },
    solidTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    ghost: { alignSelf: 'stretch', marginTop: 12, borderWidth: 1, paddingVertical: 13, alignItems: 'center' },
    ghostTxt: { fontSize: 15, fontWeight: '800' },
    off: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 60, elevation: 60, backgroundColor: '#1C1C1C', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 7 },
    offTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    offBtn: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
});