// src/screens/AccountScreen.jsx
import React, { useCallback, useEffect, useState } from 'react';
import {
    View, Text, ScrollView, TextInput, Modal, ActivityIndicator, Pressable,
    KeyboardAvoidingView, Platform, StyleSheet, Linking, Switch, Animated, Easing, InteractionManager,
} from 'react-native';
import Constants from 'expo-constants';
import PoweredBy from '../../components/common/PoweredBy';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
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
import { fetchMe, updateMe, deleteMe, updatePrefs, deleteUpload } from '../../api/customers/shopApi';
import { pickPhoto, uploadAvatar } from '../../utils/common/photoUpload';
import { tr, LANGS, useLang } from '../../i18n';
import LanguageSheet from '../../components/common/LanguageSheet';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function Item({ icon, label, sub, onPress, danger, last }) {
    const { primary, text, muted, error, border } = useBrand();
    const c = danger ? error : primary;
    return (
        <Press onPress={onPress} style={[s.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={[s.rowIc, { backgroundColor: tint(c) }]}><Ionicons name={icon} size={18} color={c} /></View>
            <View style={{ flex: 1 }}>
                <Text style={[s.rowTxt, { color: danger ? error : text }]}>{label}</Text>
                {sub ? <Text style={[s.rowSub, { color: muted }]} numberOfLines={1}>{sub}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
        </Press>
    );
}

// A big tappable tile: icon on a soft circle, a label and one line under it
function AccountTile({ icon, label, sub, onPress, badge }) {
    const { primary, text, muted, surface, border } = useBrand();
    return (
        <Press onPress={onPress} style={[s.tile, { backgroundColor: surface, borderColor: border }]}>
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
        Animated.timing(slide, { toValue: MODES.findIndex((m) => m[0] === id), duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        // the colours start gliding into the new look at once, together with the pill (the screen itself does not move)
        setTimeout(() => smoothTheme(() => setAppearance(id)), 40);
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
                {segW ? (
                    <Animated.View style={[s.segPill, { width: segW, backgroundColor: primary, transform: [{ translateX: Animated.multiply(slide, segW) }] }]} />
                ) : null}
                {MODES.map(([id, icon, label]) => {
                    const on = id === mode;
                    return (
                        <Pressable key={id} onPress={() => choose(id)} style={s.segItem} accessibilityRole="button" accessibilityState={{ selected: on }}>
                            <Ionicons name={icon} size={15} color={on ? onPrimary : muted} />
                            <Text style={[s.segTxt, { color: on ? onPrimary : muted }]}>{label}</Text>
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
    const lang = useLang((st) => st.lang);
    const [open, setOpen] = useState(false);
    const cur = LANGS.find((l) => l.code === lang);
    return (
        <>
            <Pressable onPress={() => setOpen(true)} style={[s.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
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
    return (
        <Appear delay={delay} style={s.groupWrap}>
            {title ? <Text style={[s.gTitle, { color: muted }]}>{title}</Text> : null}
            <View style={[s.group, { backgroundColor: surface, borderColor: border }]}><CardGlow radius={18} from="tl" strength={0.14} />{children}</View>
        </Appear>
    );
}

function AccountInner() {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const { primary, primaryLight, primaryDark, onPrimary, text, muted, background, surface, border } = useBrand();
    const user = useAuthStore((st) => st.user);
    const favCount = useFavStore((st) => st.ids.length);
    const unread = useNotificationStore((st) => st.unread);
    const favOn = useHomeStore((st) => st.full.features.favourites);
    const shop = useThemeStore((st) => st.theme.name);
    const shopPhone = useThemeStore((st) => st.theme.phone);
    const [me, setMe] = useState(null);
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
        fetchMe().then((u) => { if (on) setMe(u); }).catch(() => { });
        return () => { on = false; };
    }, []));

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
    ], { icon: 'camera-outline' });

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

    return (
        <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: background }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 30 }}>
                <Text style={[s.title, { color: text }]}>{tr('Account')}</Text>

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
                                        {avatarBusy ? <View style={s.avatarBusy}><ActivityIndicator color="#FFFFFF" /></View> : null}
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
                </View>

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
                    <Item icon="document-text-outline" label={tr('Terms and privacy')} onPress={() => nav.navigate('LegalList')} />
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