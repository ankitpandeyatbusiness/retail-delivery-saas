// src/ui/status.jsx
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, StatusBar, Linking } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
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
import { GREY } from '../customers/shop';

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
export function FrozenOverlay({ onOrders }) {
    const frozen = useAppStatus((st) => st.frozen);
    const user = useAuthStore((st) => st.user);
    const shop = useThemeStore((st) => st.theme.name);
    const { primary, radius, text, background, muted } = useBrand();
    const insets = useSafeAreaInsets();
    const [busy, setBusy] = useState(false);
    // The supreme admin can switch the installed app off for a shop (it lives on the website then) or both channels off. Only CUSTOMERS see this:
    // owners, riders and staff keep working, and "I run this shop" lets the owner reach the login.
    const channel = useHomeStore((st) => st.channel);
    const [staffEntry, setStaffEntry] = useState(false);
    const channelOff = !!channel?.off && (user?.role || 'customer') === 'customer' && !staffEntry;

    // told live when the shop changes, and (while it is closed) asked again every 20 seconds: this also catches a maintenance that ends by its end time
    useEffect(() => onShopChanged(() => { reloadShop(); }), []);
    useEffect(() => {
        if (!frozen && !channelOff) return undefined;
        const t = setInterval(reloadShop, 20000);
        return () => clearInterval(t);
    }, [frozen, channelOff]);

    // the owner of a closed shop: why it was closed
    const isOwner = user?.role === 'admin';
    const [why, setWhy] = useState(null);
    useEffect(() => {
        if (!frozen || !isOwner || frozen.status === 503) { setWhy(null); return; }
        fetchClosure().then(setWhy).catch(() => setWhy(null));
    }, [frozen, isOwner]);

    if (!frozen && !channelOff) return null;

    const role = user?.role || 'customer';
    const staff = role === 'kitchen' || role === 'waiter' || role === 'rider';
    const viaChannel = !frozen && channelOff;
    const title = viaChannel ? tr(channel.kind === 'web_only' ? 'We are on the website now' : 'Not available right now') : tr(role === 'customer' ? 'Closed for now' : 'Shop is closed');
    const msg = viaChannel ? tr(channel.message || 'This shop is temporarily unavailable.') : staff
        ? tr('The shop is closed. Please contact the owner.')
        : isOwner && why?.closed
            ? tr('Your shop was closed by the platform team. Please contact support.')
        : (frozen.message || tr('This shop is not accepting orders right now'));

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
                    <Text style={s.emoji}>{viaChannel ? '🌐' : '🔒'}</Text>
                    <Text style={[s.title, { color: text }]}>{title}</Text>
                    <Text style={[s.msg, { color: muted }]}>{msg}</Text>
                    <Pressable onPress={retry} disabled={busy} style={[s.solid, { backgroundColor: primary, borderRadius: radius }]}>
                        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.solidTxt}>{tr('Try again')}</Text>}
                    </Pressable>
                    {viaChannel && channel.webUrl ? (
                        <Pressable onPress={() => Linking.openURL(channel.webUrl).catch(() => { })} style={[s.solid, { backgroundColor: primary, borderRadius: radius }]}>
                            <Text style={s.solidTxt}>{tr('Open the website')}</Text>
                        </Pressable>
                    ) : null}
                    {viaChannel ? (
                        <Pressable onPress={() => setStaffEntry(true)} style={[s.ghost, { borderColor: muted, borderRadius: radius }]}>
                            <Text style={[s.ghostTxt, { color: muted }]}>{tr('I run this shop')}</Text>
                        </Pressable>
                    ) : null}
                    {user && role === 'customer' && !viaChannel ? (
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

// MAINTENANCE. One non-dismissible bar at the top of every screen, for everybody (customer, owner, staff, rider):
//   on        "Maintenance mode" + the message + "Back by <time>" or "until further notice"; while running orders are being finished: "no new orders".
//   upcoming  a planned maintenance (the shop's config carries it for the next 48 hours): the time range, and a countdown when it is near.
// The bar takes its own space (nothing is covered); the content under it is told the status bar height is 0, so no double gap (see MaintenanceFrame).
const useMaintenance = () => useAppStatus((st) => st.maintenance);

export function useMaintenanceWatcher() {
    useEffect(() => {
        let live = true;
        const ask = () => {
            fetchConfig().then((r) => {
                if (live) useAppStatus.getState().setMaintenance((r && r.maintenance) || null);
            }).catch(() => { });
        };
        ask();
        const t = setInterval(ask, 60000);
        const off = onShopChanged(ask);
        return () => { live = false; clearInterval(t); if (typeof off === 'function') off(); };
    }, []);
}

const clock = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const left = (ms) => {
    const m = Math.max(1, Math.round(ms / 60000));
    return m >= 90 ? tr('{n} hours', { n: Math.round(m / 60) }) : tr('{n} min', { n: m });
};

export function MaintenanceBar() {
    const m = useMaintenance();
    const insets = useSafeAreaInsets();
    const topPad = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0);
    const [, tick] = useState(0);
    useEffect(() => { if (!m) return undefined; const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, [m]);
    if (!m) return null;
    const valid = (v) => v && !Number.isNaN(new Date(v).getTime());
    const on = m.phase === 'on';
    let head; let line;
    if (on) {
        head = tr('Maintenance mode');
        const back = valid(m.until) ? tr('Back by {time}', { time: fmt(m.until) }) : tr('Back soon, until further notice');
        const run = m.draining ? tr('No new orders. Running orders are being finished.') : '';
        line = [m.message ? tr(m.message) : '', run, back].filter(Boolean).join(' · ');
    } else {
        head = tr('Maintenance planned');
        const when = valid(m.startAt) ? fmt(m.startAt) + (valid(m.until) ? ` ${tr('to')} ${clock(m.until)}` : '') : '';
        const ms = valid(m.startAt) ? new Date(m.startAt).getTime() - Date.now() : 0;
        line = [m.message ? tr(m.message) : '', when, ms > 0 && ms < 3 * 3600000 ? tr('Starts in {t}', { t: left(ms) }) : '', tr('Please finish your work before then.')].filter(Boolean).join(' · ');
    }
    return (
        <View style={[s.maint, { paddingTop: topPad + 6, backgroundColor: on ? '#B3261E' : '#8A5A00' }]}>
            <Text style={s.maintHead}>{on ? '🛠 ' : '⏰ '}{head}</Text>
            <Text style={s.maintTxt} numberOfLines={3}>{line}</Text>
        </View>
    );
}

// The bar on top, the app below it (grey while the maintenance is on, like a closed shop). Place this around the whole app content.
export function MaintenanceFrame({ children, background }) {
    useMaintenanceWatcher();
    const m = useMaintenance();
    const insets = useSafeAreaInsets();
    const inner = m ? { ...insets, top: 0 } : insets;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <MaintenanceBar />
            <View style={[{ flex: 1 }, m?.phase === 'on' && GREY]}>
                <SafeAreaInsetsContext.Provider value={inner}>{children}</SafeAreaInsetsContext.Provider>
            </View>
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
    maint: { paddingHorizontal: 16, paddingBottom: 8 },
    maintHead: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
    maintTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginTop: 2 },
    off: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 60, elevation: 60, backgroundColor: '#1C1C1C', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 7 },
    offTxt: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
    offBtn: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
});