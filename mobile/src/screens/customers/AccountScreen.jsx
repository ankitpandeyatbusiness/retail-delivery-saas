// src/screens/AccountScreen.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, ScrollView, TextInput, Modal, Pressable, KeyboardAvoidingView, Platform, StyleSheet, Linking, Switch, Animated, Easing, InteractionManager,
} from 'react-native';
import { ActivityIndicator } from '../../components/common/Loading';
import Constants from 'expo-constants';
import PoweredBy from '../../components/common/PoweredBy';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, GuestGate, CardGlow, smoothTheme } from '../../components/common/kit';
import { showToast, tint } from '../../components/customers/shop';
import { Press, Appear } from '../../components/customers/cartParts';
import { AddressSheet } from '../../components/customers/addresses';
import { themedAlert } from '../../components/common/dialog';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useFavStore } from '../../store/customers/shopStores';
import { fetchMe, updateMe, deleteMe, updatePrefs, deleteUpload, fetchMyBookings, fetchMyBulk, fetchMyInquiries } from '../../api/customers/shopApi';
import { useServiceFlags } from '../../utils/customers/serviceFlags';
import { useMeStore } from '../../store/customers/useMeStore';
import { pickPhoto, uploadAvatar } from '../../utils/common/photoUpload';
import { useGetApp } from '../../utils/common/installApp';
import { Skel } from '../../components/common/motion';
import OwedStrip from '../../components/customers/OwedStrip';
import { tr, LANGS, useLang } from '../../i18n';
import LanguageSheet from '../../components/common/LanguageSheet';
import { useBottomSpace } from '../../store/customers/useLiveTripStore';
import { useCustomerDesktop } from '../../utils/common/layout';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WEB = Platform.OS === 'web';   // on the website the sliders are CSS transitions (smooth even while the page is busy)

function EditDialog({ visible, me, onClose, onSaved }) {
    const { primary, radius, text, muted, surface, border, background } = useBrand();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (visible) { setName(me?.name || ''); setEmail(me?.email || ''); }
    }, [visible]);

    const save = async () => {
        const n = name.trim();
        const e = email.trim();
        if (n.length < 2 || n.length > 80) { showToast(tr('Name must be 2 to 80 characters')); return; }
        if (e && !EMAIL_RE.test(e)) { showToast(tr('Enter a valid email address')); return; }
        setSaving(true);
        try {
            const u = await updateMe({ name: n, email: e });   // empty email removes it
            onSaved(u);
            onClose();
            showToast(tr('Profile updated'));
        } catch (err) {
            showToast(err?.response?.data?.error || tr('Could not save. Try again.'));
        } finally { setSaving(false); }
    };

    const input = [s.input, { color: text, borderColor: border, backgroundColor: background }];
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={[s.dialog, { backgroundColor: surface, borderColor: border }]}>
                    <Text style={[s.dTitle, { color: text }]}>{tr('Edit profile')}</Text>
                    <Text style={[s.label, { color: muted }]}>{tr('Name')}</Text>
                    <TextInput value={name} onChangeText={setName} maxLength={80} placeholder={tr('Your name')} placeholderTextColor={muted} style={input} />
                    <Text style={[s.label, { color: muted }]}>{tr('Email (optional)')}</Text>
                    <TextInput
                        value={email} onChangeText={setEmail} maxLength={120} placeholder={tr('you@example.com')} placeholderTextColor={muted}
                        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={input}
                    />
                    <Text style={[s.label, { color: muted }]}>{tr('Phone')}</Text>
                    <TextInput value={me?.phone ? `+91 ${me.phone}` : ''} editable={false} style={[s.input, { color: muted, borderColor: border, backgroundColor: border }]} />
                    <Text style={[s.note, { color: muted }]}>{tr('Your phone number is your login, so it cannot be changed.')}</Text>
                    <View style={s.btns}>
                        <Press wrap={{ flex: 1, marginRight: 10 }} onPress={onClose} style={[s.dBtn, { borderColor: border, borderWidth: 1.5, borderRadius: radius }]}>
                            <Text style={[s.dTxt, { color: text }]}>{tr('Cancel')}</Text>
                        </Press>
                        <Press wrap={{ flex: 1.3 }} disabled={saving} onPress={save} style={[s.dBtn, { backgroundColor: primary, borderRadius: radius }]}>
                            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[s.dTxt, { color: '#FFFFFF' }]}>{tr('Save')}</Text>}
                        </Press>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

function Item({ icon, label, sub, onPress, danger, last, badge }) {
    const { primary, text, muted, error, border } = useBrand();
    const desk = useCustomerDesktop();   // the desktop website: a roomier row that lights up under the mouse (false in the phone app)
    const c = danger ? error : primary;
    if (desk) {
        return (
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                style={({ hovered }) => ({
                    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 16, cursor: 'pointer',
                    borderBottomWidth: last ? 0 : 1, borderBottomColor: border, backgroundColor: hovered ? tint(c) : 'transparent',
                    boxShadow: hovered ? `inset 4px 0 0 ${c}` : 'inset 0 0 0 transparent', transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms',
                })}
            >
                {({ hovered }) => (
                    <>
                        <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 16, backgroundColor: hovered ? c : tint(c), transform: [{ scale: hovered ? 1.06 : 1 }], transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms' }}>
                            <Ionicons name={icon} size={20} color={hovered ? '#FFFFFF' : c} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: danger ? error : text, fontSize: 15.5, fontWeight: '800' }}>{label}</Text>
                            {sub ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>{sub}</Text> : null}
                        </View>
                        {badge ? <View style={{ backgroundColor: c, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 3, marginRight: 8 }}><Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{badge}</Text></View> : null}
                        <Ionicons name="chevron-forward" size={19} color={hovered ? c : muted} style={{ transform: [{ translateX: hovered ? 4 : 0 }], transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms' }} />
                    </>
                )}
            </Pressable>
        );
    }
    return (
        <Press hover={{ backgroundColor: tint(c) }} onPress={onPress} style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={[s.rowIc, { backgroundColor: tint(c) }]}><Ionicons name={icon} size={18} color={c} /></View>
            <View style={{ flex: 1 }}>
                <Text style={[s.rowTxt, { color: danger ? error : text }]}>{label}</Text>
                {sub ? <Text style={[s.rowSub, { color: muted }]} numberOfLines={1}>{sub}</Text> : null}
            </View>
            {badge ? <View style={{ backgroundColor: c, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' }}>{badge}</Text></View> : null}
            <Ionicons name="chevron-forward" size={18} color={muted} />
        </Press>
    );
}

// A big tappable tile: icon on a soft circle, a label and one line under it
function AccountTile({ icon, label, sub, onPress, badge }) {
    const { primary, onPrimary, text, muted, surface, border } = useBrand();
    const desk = useCustomerDesktop();   // the desktop website: every effect stays INSIDE the tile (it sits in a scrolling column that would clip a lift) (false in the phone app)
    if (desk) {
        return (
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                style={({ hovered }) => ({
                    minHeight: 156, padding: 22, borderRadius: 24, borderWidth: 1.5, overflow: 'hidden', backgroundColor: surface, cursor: 'pointer',
                    borderColor: hovered ? primary : border, boxShadow: hovered ? `inset 0 0 0 1px ${primary}, inset 0 0 46px ${primary}26` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms',
                })}
            >
                {({ hovered }) => (
                    <>
                        {/* a soft colour glow in the corner that swells under the mouse */}
                        <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: primary, opacity: hovered ? 0.2 : 0.06, transform: [{ scale: hovered ? 1.25 : 1 }], transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms' }} />
                        <View style={{ width: 58, height: 58, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? primary : tint(primary), transform: [{ scale: hovered ? 1.06 : 1 }], transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms' }}>
                            <Ionicons name={icon} size={26} color={hovered ? onPrimary : primary} />
                            {badge > 0 ? <View style={[s.tileBadge, { backgroundColor: hovered ? onPrimary : primary, top: -6, right: -6 }]}><Text style={[s.tileBadgeTxt, { color: hovered ? primary : '#FFFFFF' }]}>{badge > 9 ? '9+' : badge}</Text></View> : null}
                        </View>
                        <Text style={{ color: text, fontSize: 18, fontWeight: '900', letterSpacing: -0.3, marginTop: 16 }} numberOfLines={1}>{label}</Text>
                        <Text style={{ color: muted, fontSize: 13, marginTop: 3 }} numberOfLines={1}>{sub}</Text>
                        <Ionicons name="arrow-forward" size={20} color={primary} style={{ position: 'absolute', top: 24, right: 22, opacity: hovered ? 1 : 0, transform: [{ translateX: hovered ? 0 : -10 }], transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms' }} />
                    </>
                )}
            </Pressable>
        );
    }
    return (
        <Press hover onPress={onPress} style={[s.tile, { backgroundColor: surface, borderColor: border }]}>
            <CardGlow radius={18} />
            <View style={[s.tileIc, { backgroundColor: tint(primary) }]}>
                <Ionicons name={icon} size={22} color={primary} />
                {badge > 0 ? <View style={[s.tileBadge, { backgroundColor: primary }]}><Text style={s.tileBadgeTxt}>{badge > 9 ? '9+' : badge}</Text></View> : null}
            </View>
            <Text style={[s.tileLabel, { color: text }]} numberOfLines={1}>{label}</Text>
            <Text style={[s.tileSub, { color: muted }]} numberOfLines={1}>{sub}</Text>
        </Press>
    );
}

function ToggleItem({ icon, label, sub, value, onValueChange, disabled, last }) {
    const { primary, text, muted, border } = useBrand();
    return (
        <View style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={[s.rowIc, { backgroundColor: tint(primary) }]}><Ionicons name={icon} size={18} color={primary} /></View>
            <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[s.rowTxt, { color: text }]}>{label}</Text>
                {sub ? <Text style={[s.rowSub, { color: muted }]}>{sub}</Text> : null}
            </View>
            <Switch
                value={value} onValueChange={onValueChange} disabled={disabled}
                trackColor={{ false: border, true: tint(primary) }} thumbColor={value ? primary : '#F4F4F4'}
            />
        </View>
    );
}

// Appearance: the customer's own choice, kept on this phone. System follows the phone's dark mode.
const MODES = [['system', 'phone-portrait-outline', 'System'], ['light', 'sunny-outline', 'Light'], ['dark', 'moon-outline', 'Dark']];
function AppearanceRow({ last }) {
    const { primary, onPrimary, text, muted, border, background } = useBrand();
    const saved = useThemeStore((st) => st.appearance);
    const setAppearance = useThemeStore((st) => st.setAppearance);
    // What the control draws is local and changes the instant it is tapped. The whole app re-themes only AFTER the
    // pill has finished sliding, so that heavy repaint can never make the slide stutter.
    const [mode, setMode] = useState(saved);
    const idx = Math.max(0, MODES.findIndex((m) => m[0] === mode));
    const [w, setW] = useState(0);
    const slide = React.useRef(new Animated.Value(idx)).current;
    useEffect(() => { setMode(saved); }, [saved]);
    const choose = (id) => {
        if (id === mode) return;
        setMode(id);
        if (!WEB) Animated.timing(slide, { toValue: MODES.findIndex((m) => m[0] === id), duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        // the colours start gliding into the new look at once, together with the pill (the screen itself does not move).
        // The website waits until its CSS slide has finished (the whole app re-draws in the new colours, which would freeze the slide half-way).
        setTimeout(() => smoothTheme(() => setAppearance(id)), WEB ? 340 : 40);
    };
    const segW = w ? (w - 6) / MODES.length : 0;
    return (
        <View style={[s.row, { flexDirection: 'column', alignItems: 'stretch' }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[s.rowIc, { backgroundColor: tint(primary) }]}><Ionicons name="contrast-outline" size={18} color={primary} /></View>
                <View style={{ flex: 1 }}>
                    <Text style={[s.rowTxt, { color: text }]}>{tr('Appearance')}</Text>
                    <Text style={[s.rowSub, { color: muted }]}>{mode === 'system' ? tr('Follows your phone\'s dark mode') : mode === 'dark' ? tr('Always dark') : tr('Always light')}</Text>
                </View>
            </View>
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[s.seg, { backgroundColor: background, borderColor: border }]}>
                {segW && WEB ? <View style={[s.segPill, { width: segW, backgroundColor: primary, transform: [{ translateX: idx * segW }], transitionProperty: 'transform', transitionDuration: '300ms', transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }]} /> : null}
                {segW && !WEB ? (
                    <Animated.View style={[s.segPill, { width: segW, backgroundColor: primary, transform: [{ translateX: Animated.multiply(slide, segW) }] }]} />
                ) : null}
                {MODES.map(([id, icon, label]) => {
                    const on = id === mode;
                    return (
                        <Pressable key={id} onPress={() => choose(id)} style={s.segItem} accessibilityRole="button" accessibilityState={{ selected: on }}>
                            <Ionicons name={icon} size={15} color={on ? onPrimary : muted} />
                            <Text style={[s.segTxt, { color: on ? onPrimary : muted }]}>{tr(label)}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

// Language: the customer's own choice, kept on this phone (and told to the server, so messages come in it)
function LanguageRow() {
    const { primary, text, muted, border } = useBrand();
    const desk = useCustomerDesktop();   // the desktop website: the same roomy, lit-up row as the others (false in the phone app)
    const lang = useLang((st) => st.lang);
    const [open, setOpen] = useState(false);
    const cur = LANGS.find((l) => l.code === lang);
    return (
        <>
            <Pressable onPress={() => setOpen(true)} style={({ hovered }) => [s.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }, desk && { paddingHorizontal: 22, paddingVertical: 16, borderBottomWidth: 1, cursor: 'pointer', backgroundColor: hovered ? tint(primary) : 'transparent', boxShadow: hovered ? `inset 4px 0 0 ${primary}` : 'inset 0 0 0 transparent', transitionProperty: 'background-color, border-color, box-shadow, transform, opacity', transitionDuration: '200ms' }]}>
                <View style={[s.rowIc, { backgroundColor: tint(primary) }]}><Ionicons name="language-outline" size={18} color={primary} /></View>
                <View style={{ flex: 1 }}>
                    <Text style={[s.rowTxt, { color: text }]}>{tr('Language')}</Text>
                    <Text style={[s.rowSub, { color: muted }]}>{cur?.native}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
            <LanguageSheet visible={open} onClose={() => setOpen(false)} />
        </>
    );
}

function Group({ title, delay, children }) {
    const { muted, surface, border } = useBrand();
    const desk = useCustomerDesktop();   // the desktop website: a rounder card with a soft shadow (false in the phone app)
    return (
        <Appear delay={delay} style={[s.groupWrap, desk && { marginTop: 30 }]}>
            {title ? <Text style={[s.gTitle, { color: muted }, desk && { fontSize: 12.5, letterSpacing: 1.6, marginBottom: 10 }]}>{title}</Text> : null}
            <View style={[s.group, { backgroundColor: surface, borderColor: border }, desk && { borderRadius: 24, boxShadow: '0 8px 28px rgba(0,0,0,0.10)' }]}><CardGlow radius={18} from="tl" strength={0.14} />{children}</View>
        </Appear>
    );
}

function AccountInner() {
    const desk = useCustomerDesktop();   // the desktop website (a wide browser): a roomy two-column page. False in the phone app.
    const getApp = useGetApp();   // the website only: "Get the app" / "Install the app" (false elsewhere: nothing shows in the phone app)
    const space = useBottomSpace();   // room for the floating order bar, only while it is on screen
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, background, surface, border } = useBrand();
    const user = useAuthStore((st) => st.user);
    const favCount = useFavStore((st) => st.ids.length);
    const unread = useNotificationStore((st) => st.unread);
    const favOn = useHomeStore((st) => st.full.features.favourites);
    const pointsOn = useHomeStore((st) => st.full.points?.customer !== false);
    const onlyService = useServiceFlags((st) => st.only);   // the shop's one live service, shown by its own name
    const bulkPaused = useServiceFlags((st) => st.bulkPaused);   // the owner paused bulk orders for a while
    const bulkOn = useServiceFlags((st) => st.bulkOn);   // the shop takes bulk orders (the super admin's switch and the owner's own)
    const serviceCount = useServiceFlags((st) => st.serviceCount);   // the Services section shows only when the shop offers something; kept between openings so it is there at once
    const bookingOn = useServiceFlags((st) => st.bookingOn);
    const [live, setLive] = useState({ tables: 0, next: '', bulk: 0, quote: 0, inq: 0, replied: 0 });   // what I have open in each service, for the badges
    useEffect(() => { useServiceFlags.getState().refresh(); }, []);
    const referOn = useHomeStore((st) => !!(st.full.orders.dineIn?.enabled && st.full.orders.dineIn?.referOn));
    const shop = useThemeStore((st) => st.theme.name);
    const cfgPhone = useHomeStore((st) => st.full.restaurant?.phone);   // the number the owner saved
    const themePhone = useThemeStore((st) => st.theme.phone);
    const shopPhone = cfgPhone || themePhone;
    const me = useMeStore((st) => st.me);   // loaded in the background since the app opened (store/customers/useMeStore.js)
    const setMe = useMeStore.getState().setMe;
    const [promoBusy, setPromoBusy] = useState(false);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const promos = me ? me.promotions !== false : true;   // GET /me includes it; on until the server says otherwise

    // optimistic: flip at once, put it back if the server refuses
    const setPromos = async (next) => {
        if (promoBusy || !me) return;
        setPromoBusy(true);
        setMe((m) => ({ ...m, promotions: next }));
        try { await updatePrefs({ promotions: next }); } catch (e) {
            setMe((m) => ({ ...m, promotions: !next }));
            showToast(tr('Could not save. Please try again'));
        } finally { setPromoBusy(false); }
    };
    const [edit, setEdit] = useState(false);
    const [addrSheet, setAddrSheet] = useState(false);
    const [busy, setBusy] = useState(false);

    useFocusEffect(useCallback(() => {
        let on = true;
        useMeStore.getState().refresh();
        const none = { items: [] };
        Promise.all([
            bookingOn ? fetchMyBookings().catch(() => none) : none,
            bulkOn ? fetchMyBulk().catch(() => none) : none,
            serviceCount ? fetchMyInquiries().catch(() => none) : none,
        ]).then(([b, k, q]) => {
            if (!on) return;
            const nowMs = Date.now();
            const tables = (b.items || []).filter((x) => ['confirmed', 'seated'].includes(x.status) && new Date(x.endsAt || x.startsAt) > nowMs).sort((x, y) => new Date(x.startsAt) - new Date(y.startsAt));
            const next = tables[0] ? new Date(tables[0].startsAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
            const bulkOpen = (k.items || []).filter((x) => !['delivered', 'completed', 'declined', 'cancelled', 'expired'].includes(x.status));
            const inqOpen = (q.items || []).filter((x) => !['closed', 'rejected'].includes(x.status));
            setLive({ tables: tables.length, next, bulk: bulkOpen.length, quote: bulkOpen.filter((x) => x.status === 'quoted').length, inq: inqOpen.length, replied: inqOpen.filter((x) => x.status === 'replied' || x.status === 'quoted').length });
        });
        return () => { on = false; };
    }, [bookingOn, bulkOn, serviceCount]));

    const p = me || user || {};
    const name = p.name || '';
    const phone = p.phone ? (/^\d{10}$/.test(String(p.phone)) ? `+91 ${p.phone}` : String(p.phone)) : '';
    const initial = (name[0] || String(p.phone || '?')[0] || '?').toUpperCase();

    const saved = (u) => {
        setMe(u);
        useAuthStore.setState((st) => (st.user ? { user: { ...st.user, name: u.name, email: u.email } } : {}));
    };

    // profile picture: camera or gallery (cropped square), or remove
    const changeAvatar = async (source) => {
        if (avatarBusy) return;
        let picked;
        try { picked = await pickPhoto(source, { square: true }); } catch (e) { showToast(e.safe ? e.message : tr('Could not open the camera or gallery')); return; }
        if (!picked) return;
        setAvatarBusy(true);
        try {
            const up = await uploadAvatar({ uri: picked.uri, mimeType: picked.mimeType });
            setMe((m) => ({ ...(m || {}), avatarUrl: up.url, avatarId: up.id }));
            showToast(tr('Profile photo updated'));
        } catch (e) {
            showToast(e.safe ? e.message : tr('Could not update your photo'));
        } finally { setAvatarBusy(false); }
    };

    const removeAvatar = async () => {
        if (avatarBusy || !me?.avatarId) return;
        setAvatarBusy(true);
        try {
            await deleteUpload(me.avatarId);
            setMe((m) => ({ ...(m || {}), avatarUrl: null, avatarId: null }));
            showToast(tr('Profile photo removed'));
        } catch (e) {
            showToast(tr('Could not remove your photo. Please try again'));
        } finally { setAvatarBusy(false); }
    };

    const avatarMenu = () => themedAlert(tr('Profile photo'), tr('Choose a picture for your account.'), [
        { text: tr('Take a photo'), onPress: () => changeAvatar('camera') },
        { text: tr('Choose from gallery'), onPress: () => changeAvatar('gallery') },
        ...(me?.avatarUrl ? [{ text: 'Remove photo', style: 'destructive', onPress: removeAvatar }] : []),
        { text: tr('Cancel'), style: 'cancel' },
    ], { icon: 'camera-outline', noGrey: true });

    const signOut = async () => {
        try { await useAuthStore.getState().logout(); } catch (e) { /* the navigator resets to Login */ }
        useFavStore.getState().reset();
    };

    const doLogout = () => themedAlert(tr('Log out?'), tr('You will need to log in again to order.'), [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Log out'), onPress: signOut },
    ], { icon: 'log-out-outline' });

    const doDelete = () => themedAlert(
        tr('Delete your account?'),
        tr('Your profile, saved addresses and favourites will be removed. Past orders stay with the shop. This cannot be undone.'),
        [
            { text: tr('Cancel'), style: 'cancel' },
            {
                text: tr('Delete'),
                style: 'destructive',
                onPress: async () => {
                    setBusy(true);
                    try {
                        await deleteMe();
                        showToast(tr('Account deleted'));
                        await signOut();
                    } catch (e) {
                        const m = e?.response?.data?.error;
                        if (m) themedAlert(tr('Cannot delete account'), m); else showToast(tr('Network problem. Try again.'));
                    } finally { setBusy(false); }
                },
            },
        ],
        { icon: 'trash-outline' },
    );

    const shopDigits = String(shopPhone || '').replace(/\D/g, '').slice(-10);
    const callShop = () => Linking.openURL(`tel:+91${shopDigits}`).catch(() => showToast(tr('Could not open the dialer')));

    if (desk) {
        // ---- the desktop page: the person on the left, everything to open and change on the right ----
        const tiles = [
            <AccountTile key="o" icon="receipt-outline" label={tr('Orders')} sub={tr('Track and reorder')} onPress={() => nav.navigate('Orders')} />,
            <AccountTile key="a" icon="location-outline" label={tr('Addresses')} sub={tr('Where we deliver')} onPress={() => setAddrSheet(true)} />,
            favOn
                ? <AccountTile key="f" icon="heart-outline" label={tr('Favourites')} sub={favCount ? tr('{favCount} saved', { favCount: favCount }) : tr('Dishes you love')} onPress={() => nav.navigate('Favourites')} />
                : <AccountTile key="f" icon="pricetags-outline" label={tr('Offers')} sub={tr('Coupons for you')} onPress={() => nav.navigate('Offers')} />,
            <AccountTile key="n" icon="notifications-outline" label={tr('Notifications')} sub={unread > 0 ? tr('{unread} unread', { unread: unread }) : tr('All caught up')} badge={unread} onPress={() => nav.navigate('Notifications')} />,
            <AccountTile key="s" icon="volume-high-outline" label={tr('Alert sounds')} sub={tr('Choose what rings')} onPress={() => nav.navigate('AlertSettings')} />,
            ...(referOn ? [<AccountTile key="r" icon="gift-outline" label={tr('Refer a friend')} sub={tr('Share your code')} onPress={() => nav.navigate('ReferFriend')} />] : []),
        ];
        const rowsOf = [];
        for (let i = 0; i < tiles.length; i += 3) rowsOf.push(tiles.slice(i, i + 3));
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                {/* the page itself does not scroll: the title stays, the person's card is centred, only the right column scrolls */}
                <View style={{ flex: 1, width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 26 }}>
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: text, fontSize: 30, fontWeight: '900', letterSpacing: -0.6, marginBottom: 6 }}>{tr('Account')}</Text>
                        <OwedStrip style={{ marginHorizontal: 0, marginTop: 10 }} />
                        <View style={{ flex: 1, flexDirection: 'row', gap: 28, marginTop: 8 }}>
                            {/* LEFT: the person, centred in the height that is left */}
                            <View style={{ width: 340, justifyContent: 'center', paddingBottom: 50 }}>
                                <Appear>
                                    <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 24, padding: 26, overflow: 'hidden', marginTop: 12, alignItems: 'center' }}>
                                        <View style={[s.blob, { top: -50, right: -30, width: 180, height: 180 }]} />
                                        <View style={[s.blob, { bottom: -60, left: 20, width: 130, height: 130, opacity: 0.6 }]} />
                                        <Pressable onPress={avatarMenu} disabled={avatarBusy} accessibilityLabel={tr('Profile photo')} style={({ hovered }) => ({ cursor: 'pointer', transform: [{ scale: hovered ? 1.04 : 1 }], transitionProperty: 'transform', transitionDuration: '170ms' })}>
                                            <View style={[s.avatarRing, { padding: 4, borderRadius: 64 }]}>
                                                <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                                                    {p.avatarUrl
                                                        ? <Image source={{ uri: p.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                                                        : <Text style={{ color: onPrimary, fontSize: 44, fontWeight: '800' }}>{initial}</Text>}
                                                    {avatarBusy || !me ? <View style={StyleSheet.absoluteFill}><Skel width="100%" height="100%" radius={999} /></View> : null}
                                                </View>
                                            </View>
                                            <View style={[s.camBadge, { backgroundColor: surface, borderColor: border, width: 32, height: 32, borderRadius: 16, right: 2, bottom: 2 }]}>
                                                <Ionicons name="camera" size={16} color={primary} />
                                            </View>
                                        </Pressable>
                                        <Text style={{ color: onPrimary, fontSize: 24, fontWeight: '900', letterSpacing: -0.4, marginTop: 16, textAlign: 'center' }} numberOfLines={2}>{name || tr('Add your name')}</Text>
                                        {phone ? <Text style={{ color: onPrimary, fontSize: 14, marginTop: 4, opacity: 0.9 }}>{phone}</Text> : null}
                                        {p.email ? <Text style={{ color: onPrimary, fontSize: 13.5, marginTop: 2, opacity: 0.88 }} numberOfLines={1}>{p.email}</Text> : null}
                                        <Pressable
                                            onPress={() => setEdit(true)}
                                            accessibilityRole="button"
                                            style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', marginTop: 20, height: 42, paddingHorizontal: 22, borderRadius: 21, backgroundColor: hovered ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '170ms' })}
                                        >
                                            <Ionicons name="create-outline" size={17} color={onPrimary} />
                                            <Text style={{ color: onPrimary, fontSize: 14, fontWeight: '800', marginLeft: 8 }}>{tr('Edit profile')}</Text>
                                        </Pressable>
                                    </LinearGradient>
                                </Appear>
                                {!name ? (
                                    <Pressable onPress={() => setEdit(true)} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', marginTop: 16, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: primary, backgroundColor: hovered ? `${primary}26` : tint(primary), cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '170ms' })}>
                                        <Ionicons name="person-circle-outline" size={22} color={primary} />
                                        <Text style={{ flex: 1, color: text, fontSize: 13.5, fontWeight: '700', marginLeft: 10 }}>{tr('Add your name so the shop knows who is ordering')}</Text>
                                    </Pressable>
                                ) : null}
                            </View>

                            {/* RIGHT: tiles and settings: this is the part that scrolls */}
                            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 90 }}>
                                <View style={{ marginTop: 12, gap: 14 }}>
                                    {rowsOf.map((r, ri) => (
                                        <View key={ri} style={{ flexDirection: 'row', gap: 14 }}>
                                            {[0, 1, 2].map((ci) => <View key={ci} style={{ flex: 1 }}>{r[ci] || null}</View>)}
                                        </View>
                                    ))}
                                </View>
                                <View style={{ marginHorizontal: -16 }}>
                                    {serviceCount || bookingOn || bulkOn ? (
                                        <Group title={tr('SERVICES')} delay={90}>
                                            {bookingOn ? <Item icon="calendar-outline" label={tr('Reserve a table')} sub={live.next ? tr('Your next table: {d}', { d: live.next }) : tr('Book a table. Your reservations are inside')} badge={live.tables ? tr('{n} active', { n: live.tables }) : ''} onPress={() => nav.navigate('BookTable')} last={!bulkOn && !serviceCount} /> : null}
                                            {bulkOn ? <Item icon="cube-outline" label={tr('Bulk order')} sub={bulkPaused ? tr('Temporarily unavailable') : live.quote ? tr('A quote is waiting for you') : tr('Pick dishes and quantities for an office, a function or a party. The shop sends you a quote.')} badge={live.bulk ? tr('{n} active', { n: live.bulk }) : ''} onPress={() => nav.navigate('BulkOrder')} last={!serviceCount} /> : null}
                                            {serviceCount === 1 && onlyService
                                                ? <Item icon={onlyService.icon} label={tr(onlyService.name)} sub={onlyService.paused ? tr('Temporarily unavailable') : live.replied ? tr('The shop replied to you') : tr('Ask the shop. Your inquiries are inside')} badge={live.inq ? tr('{n} active', { n: live.inq }) : ''} onPress={() => nav.navigate('ServiceForm', { id: onlyService.id })} last />
                                                : serviceCount ? <Item icon="briefcase-outline" label={tr('Services')} sub={live.replied ? tr('The shop replied to you') : tr('Tiffin, party booking and more')} badge={live.inq ? tr('{n} active', { n: live.inq }) : ''} onPress={() => nav.navigate('Services')} last /> : null}
                                        </Group>
                                    ) : null}
                                    {pointsOn ? <Group title={tr('REWARDS')} delay={100}><Item icon="gift-outline" label={tr('My points')} sub={tr('Earn points and get money off')} onPress={() => nav.navigate('MyPoints')} last /></Group> : null}
                                    <Group title={tr('PREFERENCES')} delay={110}>
                                        <LanguageRow />
                                        <AppearanceRow />
                                        <ToggleItem icon="megaphone-outline" label={tr('Offers and promotions')} sub={tr('Order updates always reach you, even when this is off')} value={promos} onValueChange={setPromos} disabled={!me || promoBusy} last />
                                    </Group>
                                    {shopPhone ? <Group title={tr('HELP')} delay={140}><Item icon="call-outline" label={tr('Contact {v1}', { v1: shop || 'the shop' })} sub={tr('Call +91 {shopDigits}', { shopDigits: shopDigits })} onPress={callShop} last /></Group> : null}
                                    <Group title={tr('MANAGE')} delay={200}>
                                        {getApp.show ? <Item icon="download-outline" label={getApp.kind === 'store' ? tr('Get the app') : tr('Install the app')} onPress={getApp.open} /> : null}
                                        <Item icon="information-circle-outline" label={tr('About Us')} onPress={() => nav.navigate('AboutUs')} />
                                        <Item icon="phone-portrait-outline" label={tr("Where you're logged in")} onPress={() => nav.navigate('Sessions')} />
                                        <Item icon="log-out-outline" label={tr('Log out')} onPress={doLogout} />
                                        <Item icon="trash-outline" label={tr('Delete account')} onPress={doDelete} danger last />
                                    </Group>
                                </View>
                                <Text style={[s.ver, { color: muted }]}>{tr('{shop} · v{v2}', { shop: shop, v2: Constants.expoConfig?.version || '1.0' })}</Text>
                            </ScrollView>
                        </View>
                    </View>
                </View>
                <EditDialog visible={edit} me={p} onClose={() => setEdit(false)} onSaved={saved} />
                <AddressSheet visible={addrSheet} onClose={() => setAddrSheet(false)} onChanged={(L) => useAddressStore.getState().sync(L)} manage />
                {busy ? <View style={s.busy}><ActivityIndicator color="#FFFFFF" size="large" /></View> : null}
            </View>
        );
    }

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space }}>
                <Text style={[s.title, { color: text }]}>{tr('Account')}</Text>
                <OwedStrip style={{ marginHorizontal: 0 }} />

                {/* hero: the brand gradient with the person's photo, name and number */}
                <Appear style={s.heroWrap}>
                    <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
                        <View style={[s.blob, { top: -50, right: -30, width: 160, height: 160 }]} />
                        <View style={[s.blob, { bottom: -60, left: 40, width: 110, height: 110, opacity: 0.6 }]} />
                        <View style={s.heroRow}>
                            <Pressable onPress={avatarMenu} disabled={avatarBusy} hitSlop={6} style={s.avatarWrap}>
                                <View style={s.avatarRing}>
                                    <View style={[s.avatar, { backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden', marginRight: 0 }]}>
                                        {p.avatarUrl
                                            ? <Image source={{ uri: p.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                                            : <Text style={[s.avatarTxt, { color: onPrimary }]}>{initial}</Text>}
                                        {avatarBusy || !me ? <View style={StyleSheet.absoluteFill}><Skel width="100%" height="100%" radius={999} /></View> : null}
                                    </View>
                                </View>
                                <View style={[s.camBadge, { backgroundColor: surface, borderColor: border }]}>
                                    <Ionicons name="camera" size={12} color={primary} />
                                </View>
                            </Pressable>
                            <View style={{ flex: 1 }}>
                                <Text style={[s.heroName, { color: onPrimary }]} numberOfLines={1}>{name || tr('Add your name')}</Text>
                                {phone ? <Text style={[s.heroSub, { color: onPrimary }]}>{phone}</Text> : null}
                                {p.email ? <Text style={[s.heroSub, { color: onPrimary }]} numberOfLines={1}>{p.email}</Text> : null}
                            </View>
                            <Press onPress={() => setEdit(true)} style={s.heroEdit}>
                                <Ionicons name="create-outline" size={15} color={onPrimary} />
                                <Text style={[s.editTxt, { color: onPrimary }]}>{tr('Edit')}</Text>
                            </Press>
                        </View>
                    </LinearGradient>
                </Appear>

                {!name ? (
                    <Appear delay={60} style={s.groupWrap}>
                        <Press onPress={() => setEdit(true)} style={[s.nudge, { backgroundColor: tint(primary), borderColor: primary }]}>
                            <Ionicons name="person-circle-outline" size={22} color={primary} />
                            <Text style={[s.nudgeTxt, { color: text }]}>{tr('Add your name so the shop knows who is ordering')}</Text>
                        </Press>
                    </Appear>
                ) : null}

                {/* the four things people come here for, as big tiles */}
                <View style={s.tiles}>
                    <Appear delay={60} style={s.tileCell}>
                        <AccountTile icon="receipt-outline" label={tr('Orders')} sub={tr('Track and reorder')} onPress={() => nav.navigate('Orders')} />
                    </Appear>
                    <Appear delay={90} style={s.tileCell}>
                        <AccountTile icon="location-outline" label={tr('Addresses')} sub={tr('Where we deliver')} onPress={() => setAddrSheet(true)} />
                    </Appear>
                    <Appear delay={120} style={s.tileCell}>
                        {favOn
                            ? <AccountTile icon="heart-outline" label={tr('Favourites')} sub={favCount ? tr('{favCount} saved', { favCount: favCount }) : tr('Dishes you love')} onPress={() => nav.navigate('Favourites')} />
                            : <AccountTile icon="pricetags-outline" label={tr('Offers')} sub={tr('Coupons for you')} onPress={() => nav.navigate('Offers')} />}
                    </Appear>
                    <Appear delay={150} style={s.tileCell}>
                        <AccountTile icon="notifications-outline" label={tr('Notifications')} sub={unread > 0 ? tr('{unread} unread', { unread: unread }) : tr('All caught up')} badge={unread} onPress={() => nav.navigate('Notifications')} />
                    </Appear>
                    <Appear delay={165} style={s.tileCell}>
                        <AccountTile icon="volume-high-outline" label={tr('Alert sounds')} sub={tr('Choose what rings')} onPress={() => nav.navigate('AlertSettings')} />
                    </Appear>
                    {referOn ? (
                        <Appear delay={180} style={s.tileCell}>
                            <AccountTile icon="gift-outline" label={tr('Refer a friend')} sub={tr('Share your code')} onPress={() => nav.navigate('ReferFriend')} />
                        </Appear>
                    ) : null}
                </View>

                {serviceCount || bookingOn || bulkOn ? (
                    <Group title={tr('SERVICES')} delay={90}>
                        {bookingOn ? <Item icon="calendar-outline" label={tr('Reserve a table')} sub={live.next ? tr('Your next table: {d}', { d: live.next }) : tr('Book a table. Your reservations are inside')} badge={live.tables ? tr('{n} active', { n: live.tables }) : ''} onPress={() => nav.navigate('BookTable')} last={!bulkOn && !serviceCount} /> : null}
                        {bulkOn ? <Item icon="cube-outline" label={tr('Bulk order')} sub={bulkPaused ? tr('Temporarily unavailable') : live.quote ? tr('A quote is waiting for you') : tr('Pick dishes and quantities for an office, a function or a party. The shop sends you a quote.')} badge={live.bulk ? tr('{n} active', { n: live.bulk }) : ''} onPress={() => nav.navigate('BulkOrder')} last={!serviceCount} /> : null}
                        {serviceCount === 1 && onlyService
                            ? <Item icon={onlyService.icon} label={tr(onlyService.name)} sub={onlyService.paused ? tr('Temporarily unavailable') : live.replied ? tr('The shop replied to you') : tr('Ask the shop. Your inquiries are inside')} badge={live.inq ? tr('{n} active', { n: live.inq }) : ''} onPress={() => nav.navigate('ServiceForm', { id: onlyService.id })} last />
                            : serviceCount ? <Item icon="briefcase-outline" label={tr('Services')} sub={live.replied ? tr('The shop replied to you') : tr('Tiffin, party booking and more')} badge={live.inq ? tr('{n} active', { n: live.inq }) : ''} onPress={() => nav.navigate('Services')} last /> : null}
                    </Group>
                ) : null}

                {pointsOn ? (
                    <Group title={tr('REWARDS')} delay={100}>
                        <Item icon="gift-outline" label={tr('My points')} sub={tr('Earn points and get money off')} onPress={() => nav.navigate('MyPoints')} last />
                    </Group>
                ) : null}

                <Group title={tr('PREFERENCES')} delay={110}>
                    <LanguageRow />
                    <AppearanceRow />
                    <ToggleItem
                        icon="megaphone-outline" label={tr('Offers and promotions')}
                        sub={tr('Order updates always reach you, even when this is off')}
                        value={promos} onValueChange={setPromos} disabled={!me || promoBusy} last
                    />
                </Group>

                {shopPhone ? (
                    <Group title={tr('HELP')} delay={140}>
                        <Item icon="call-outline" label={tr('Contact {v1}', { v1: shop || 'the shop' })} sub={tr('Call +91 {shopDigits}', { shopDigits: shopDigits })} onPress={callShop} last />
                    </Group>
                ) : null}

                <Group title={tr('MANAGE')} delay={200}>
                    {getApp.show ? <Item icon="download-outline" label={getApp.kind === 'store' ? tr('Get the app') : tr('Install the app')} onPress={getApp.open} /> : null}   {/* the website only */}
                    <Item icon="information-circle-outline" label={tr('About Us')} onPress={() => nav.navigate('AboutUs')} />
                    <Item icon="phone-portrait-outline" label={tr("Where you're logged in")} onPress={() => nav.navigate('Sessions')} />
                    <Item icon="log-out-outline" label={tr('Log out')} onPress={doLogout} />
                    <Item icon="trash-outline" label={tr('Delete account')} onPress={doDelete} danger last />
                </Group>

                <Text style={[s.ver, { color: muted }]}>{tr('{shop} · v{v2}', { shop: shop, v2: Constants.expoConfig?.version || '1.0' })}</Text>
                <PoweredBy />
            </ScrollView>

            <EditDialog visible={edit} me={p} onClose={() => setEdit(false)} onSaved={saved} />
            <AddressSheet visible={addrSheet} onClose={() => setAddrSheet(false)} onChanged={(L) => useAddressStore.getState().sync(L)} manage />
            {busy ? <View style={s.busy}><ActivityIndicator color="#FFFFFF" size="large" /></View> : null}
        </View>
    );
}

export default function AccountScreen() {
    return <GuestGate title={tr('Account')}><AccountInner /></GuestGate>;
}

const s = StyleSheet.create({
    title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5, paddingHorizontal: 16, paddingTop: 14 },
    head: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 14, padding: 16, borderWidth: 1, borderRadius: 20 },
    avatarWrap: { marginRight: 14 },
    avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
    avatarBusy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    camBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    avatarTxt: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
    name: { fontSize: 18, fontWeight: '800' },
    sub: { fontSize: 12, marginTop: 2 },
    editBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
    editTxt: { fontSize: 13, fontWeight: '800', marginLeft: 4 },
    nudge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 12 },
    nudgeTxt: { flex: 1, fontSize: 13, fontWeight: '700', marginLeft: 10 },
    groupWrap: { marginHorizontal: 16, marginTop: 18 },
    gTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
    group: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14 },
    rowIc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    rowTxt: { fontSize: 14, fontWeight: '700' },
    rowSub: { fontSize: 11, marginTop: 2 },
    ver: { textAlign: 'center', fontSize: 11, marginTop: 26 },
    heroWrap: { marginHorizontal: 16, marginTop: 14 },
    hero: { borderRadius: 24, padding: 18, overflow: 'hidden' },
    blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
    heroRow: { flexDirection: 'row', alignItems: 'center' },
    avatarRing: { padding: 3, borderRadius: 40, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
    heroName: { fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
    heroSub: { fontSize: 12.5, marginTop: 2, opacity: 0.88 },
    heroEdit: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 16 },
    tileCell: { width: '48.5%', marginBottom: 12 },
    tile: { borderWidth: 1, borderRadius: 18, padding: 14, minHeight: 112 },
    tileIc: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    tileBadge: { position: 'absolute', top: -5, right: -6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
    tileBadgeTxt: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
    tileLabel: { fontSize: 15, fontWeight: '900', marginTop: 12 },
    tileSub: { fontSize: 11.5, marginTop: 2 },
    seg: { flexDirection: 'row', height: 40, borderRadius: 12, borderWidth: 1, padding: 3, marginTop: 12 },
    segPill: { position: 'absolute', left: 3, top: 3, bottom: 3, borderRadius: 9 },
    segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    segTxt: { fontSize: 12.5, fontWeight: '800', marginLeft: 5 },
    busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 18 },
    dialog: { width: '100%', maxWidth: 380, borderRadius: 22, borderWidth: 1, padding: 20 },
    dTitle: { fontSize: 18, fontWeight: '900', marginBottom: 4 },
    label: { fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 4 },
    input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14 },
    note: { fontSize: 11, marginTop: 6 },
    btns: { flexDirection: 'row', marginTop: 18 },
    dBtn: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
    dTxt: { fontSize: 14, fontWeight: '800' },
});