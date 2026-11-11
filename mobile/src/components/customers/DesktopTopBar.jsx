// The sticky top bar of the DESKTOP website (a browser at least 1024 px wide). It replaces the phone's header, search bar and bottom tabs:
//   [logo + shop]  [Deliver to Home v]  [ search ........ mic | veg ]  [ Delivery | Pickup | Dine in ]  [Offers] [Orders] [Bell] [Cart] [Account]
// Everything in it follows what the shop has switched on, so it never shows a dead button or leaves a gap:
//   - the "where" pill follows the order type (delivery address / pickup / dine-in table) and is left out for a guest who has no address yet
//   - the Delivery | Pickup | Dine in switch only when the shop offers two or more ways to order
//   - the VEG switch only when the shop has the Veg switch on and serves both veg and non-veg
//   - Offers only when coupons are on; Orders only when the Orders tab is on; the bell only for a logged-in person; the cart only once it has something in it
//   - the mic only where the browser can listen (Chrome, Edge, Safari)
// Never drawn in the phone app: DesktopFrame returns the plain children there.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useViewMode } from '../../store/owners/useViewMode';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useMenuStore, useCartStore } from '../../store/customers/shopStores';
import { useFilterStore } from '../../store/customers/useFilterStore';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { useMeStore } from '../../store/customers/useMeStore';
import { useOrderMode, modesOf } from '../../store/customers/useOrderMode';
import { ask } from '../common/dialog';
import { showToast } from './shop';
import { AddressSheet } from './addresses';
import TableSheet from './TableSheet';
import { tr } from '../../i18n';

const HEIGHT = 64;

// the browser's own speech recognition (there is none in Firefox): the mic is shown only when it exists
const SpeechApi = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;

// Why the browser refused, in words the customer can act on (the button used to fail without a sound)
function voiceProblem(code) {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
            return tr('The microphone is blocked. Allow it with the lock icon next to the address, then try again.');
        case 'audio-capture': return tr('No microphone found. Connect one and try again.');
        case 'no-speech': return tr('Didn\'t catch that. Try again.');
        case 'network':
            // Chrome and Edge send the sound to Google / Microsoft; Brave and some networks block that
            return tr('Voice search is not available in this browser right now. Try Chrome or Edge, or type your search.');
        case 'aborted': return '';
        default: return tr('Couldn\'t hear that. Try again.');
    }
}

function useWebVoice(onText) {
    const [on, setOn] = useState(false);
    const rec = useRef(null);
    const heard = useRef(false);
    const cb = useRef(onText);
    cb.current = onText;
    const start = () => {
        if (!SpeechApi) return;
        if (on) { try { rec.current?.stop(); } catch (e) { /* already stopped */ } return; }
        if (typeof window !== 'undefined' && window.isSecureContext === false) { showToast(tr('Voice search needs a secure (https) address.')); return; }
        try {
            const r = new SpeechApi();
            r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
            heard.current = false;
            r.onstart = () => { setOn(true); showToast(tr('Listening... say a dish name')); };
            r.onspeechend = () => { try { r.stop(); } catch (e) { /* ignore */ } };
            r.onend = () => { setOn(false); };
            r.onerror = (e) => { setOn(false); const m = voiceProblem(e?.error); if (m) showToast(m); };
            r.onresult = (e) => { const t = e.results?.[0]?.[0]?.transcript; if (t) { heard.current = true; cb.current(t); } };
            rec.current = r;
            r.start();
        } catch (e) { setOn(false); showToast(tr('Couldn\'t start voice search. Try again.')); }
    };
    return { supported: !!SpeechApi, on, start };
}

// a round icon button with a hover state; the badge is a small number on its corner
function IconBtn({ icon, label, onPress, badge, active, brand }) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ hovered }) => ({
                height: 40, minWidth: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 8,
                backgroundColor: active || hovered ? brand.soft || brand.background : 'transparent',
                borderWidth: 1, borderColor: active ? brand.primary : hovered ? brand.muted : brand.border, cursor: 'pointer',
            })}
        >
            <Ionicons name={icon} size={19} color={active ? brand.primary : brand.text} />
            {badge ? (
                <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderWidth: 2, borderColor: brand.surface }}>
                    <Text style={{ color: brand.onPrimary || '#FFFFFF', fontSize: 10, fontWeight: '900' }}>{badge}</Text>
                </View>
            ) : null}
        </Pressable>
    );
}

// the veg mark: a square with a dot (green = veg)
const VegMark = ({ size = 14 }) => (
    <View style={{ width: size, height: size, borderWidth: 1.5, borderColor: '#2E7D32', borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: size * 0.46, height: size * 0.46, borderRadius: size, backgroundColor: '#2E7D32' }} />
    </View>
);

// The Veg switch: a small sliding switch with a fixed size (it can never be squeezed out of the search box). The knob slides and the green fills in
// with a CSS transition. Turning it ON is at once; turning it OFF asks first, exactly like the phone ("Turn off veg mode?"): the switch only moves
// if the customer confirms. The filter itself is applied after the slide, because changing it repaints the whole menu.
function VegToggle({ on, onSet, brand }) {
    const [shown, setShown] = useState(on);   // what the switch draws right now
    const busy = useRef(false);
    useEffect(() => { setShown(on); }, [on]);   // someone else changed it (the Search page shares the filter): follow
    const commit = (next) => {
        if (busy.current) return;
        busy.current = true;
        setShown(next);
        setTimeout(() => { busy.current = false; onSet(next); }, 260);
    };
    const press = () => {
        if (busy.current) return;
        if (shown) {
            ask({
                title: tr('Turn off veg mode?'),
                message: tr('You will start seeing non-veg dishes again in the menu, bestsellers and search.'),
                icon: 'leaf-outline',
                confirmText: tr('Keep veg only'),
                cancelText: tr('Turn off'),
            }).then((keep) => { if (keep === false) commit(false); });   // only the "Turn off" button; tapping outside changes nothing
            return;
        }
        commit(true);
    };
    const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
    return (
        <Pressable onPress={press} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: shown }} accessibilityLabel={tr('Veg only')} style={{ flexShrink: 0, marginLeft: 6, marginRight: 2, cursor: 'pointer' }}>
            <View style={{ width: 58, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: shown ? '#0F8A3C' : brand.border, backgroundColor: brand.surface, justifyContent: 'center', overflow: 'hidden', transitionProperty: 'border-color', transitionDuration: '260ms' }}>
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0F8A3C', opacity: shown ? 1 : 0, transitionProperty: 'opacity', transitionDuration: '260ms', transitionTimingFunction: ease }} />
                {/* a leaf on the side the knob has left (the word would not fit in other languages) */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 9, width: 14, alignItems: 'center', justifyContent: 'center', opacity: shown ? 1 : 0, transitionProperty: 'opacity', transitionDuration: '260ms' }}>
                    <Ionicons name="leaf" size={14} color="#FFFFFF" />
                </View>
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, right: 9, width: 14, alignItems: 'center', justifyContent: 'center', opacity: shown ? 0 : 1, transitionProperty: 'opacity', transitionDuration: '260ms' }}>
                    <Ionicons name="leaf" size={14} color={brand.muted} />
                </View>
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute', top: 3, left: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.3)', transform: [{ translateX: shown ? 28 : 0 }], transitionProperty: 'transform', transitionDuration: '260ms', transitionTimingFunction: ease,
                    }}
                >
                    <VegMark size={13} />
                </View>
            </View>
        </Pressable>
    );
}

// Delivery | Pickup | Dine in as one small pill. ONE coloured pill slides under the labels to the way that was picked (like the phone's slider):
// its place is measured from the buttons, and a CSS transition moves it. The label colours change half-way through the slide, so a white
// label never sits on the bar's own background while the pill is still on its way.
function ModeSwitch({ modes, value, onChange, brand, compact }) {
    const META = { delivery: ['bicycle', 'Delivery'], pickup: ['bag-handle', 'Pickup'], dine_in: ['restaurant', 'Dine in'] };
    const [box, setBox] = useState({});          // { mode: { x, w } }
    // The pill moves at once (`sel`); the choice is handed on only after the slide has finished, because changing the order type repaints the
    // whole page and that would freeze the slide half-way.
    const [sel, setSel] = useState(value);
    useEffect(() => { setSel(value); }, [value]);
    const pick = (m) => { if (m === sel) return; setSel(m); setTimeout(() => onChange(m), 320); };
    const [lit, setLit] = useState(value);       // which label is drawn as "chosen" (follows the pill a moment later)
    useEffect(() => { const t = setTimeout(() => setLit(sel), 130); return () => clearTimeout(t); }, [sel]);
    const at = box[sel];
    const onP = brand.onPrimary || '#FFFFFF';
    return (
        <View style={{ flexDirection: 'row', padding: 3, borderRadius: 22, backgroundColor: brand.background, borderWidth: 1, borderColor: brand.border, marginLeft: 12 }}>
            {at ? (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute', top: 3, bottom: 3, left: at.x, width: at.w, borderRadius: 17, backgroundColor: brand.primary,
                        transitionProperty: 'left, width', transitionDuration: '300ms', transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                />
            ) : null}
            {modes.map((m) => {
                const on = m === lit;
                const [icon, label] = META[m] || ['ellipse', m];
                return (
                    <Pressable
                        key={m}
                        onPress={() => pick(m)}
                        onLayout={(e) => { const { x, width: w } = e.nativeEvent.layout; setBox((b) => (b[m] && b[m].x === x && b[m].w === w ? b : { ...b, [m]: { x, w } })); }}
                        accessibilityRole="button"
                        accessibilityLabel={tr(label)}
                        accessibilityState={{ selected: m === sel }}
                        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: compact ? 12 : 14, borderRadius: 17, backgroundColor: hovered && !on ? `${brand.primary}1F` : 'transparent', cursor: 'pointer' })}
                    >
                        <Ionicons name={icon} size={15} color={on ? onP : brand.text} />
                        {compact ? null : <Text style={{ marginLeft: 6, fontSize: 13, fontWeight: '800', color: on ? onP : brand.text }}>{tr(label)}</Text>}
                    </Pressable>
                );
            })}
        </View>
    );
}

export default function DesktopTopBar({ navRef, routeName }) {
    const brand = useBrand();
    const { width } = useWindowDimensions();
    const theme = useThemeStore((s) => s.theme);
    const user = useAuthStore((s) => s.user);
    const full = useHomeStore((s) => s.full);
    const config = useHomeStore((s) => s.config);
    const unread = useNotificationStore((s) => s.unread);
    const cartCount = useCartStore((s) => s.lines.reduce((a, l) => a + l.quantity, 0));
    const menuCats = useMenuStore((s) => s.categories);
    const veg = useFilterStore((s) => s.active.includes('veg_only'));
    const toggleFilter = useFilterStore((s) => s.toggleFilter);
    // set the veg filter to a value (not "flip it"): safe even if it is pressed twice quickly
    const setVeg = (next) => { if (useFilterStore.getState().active.includes('veg_only') !== next) toggleFilter('veg_only'); };
    const lastCart = useRef(0);   // the count keeps showing on the badge while the button is shrinking away
    if (cartCount > 0) lastCart.current = cartCount;
    const cartShown = cartCount > 0 ? cartCount : lastCart.current;

    const mode = useOrderMode((s) => s.mode);
    const setMode = useOrderMode((s) => s.setMode);
    const table = useOrderMode((s) => s.table);
    const addr = useAddressStore((s) => s.selected);
    const photo = useMeStore((s) => s.me?.avatarUrl) || user?.avatarUrl || null;   // the profile picture (set on the Account page)
    const userKey = user?.id || user?._id || null;
    useEffect(() => { if (userKey) useMeStore.getState().refresh(); }, [userKey]);   // so the picture is here even if the Account page was never opened
    const preview = useViewMode((s) => s.customerView);   // an owner previewing the shop has the customer tabs inside CustomerPreview
    const [addrOpen, setAddrOpen] = useState(false);
    const [tableOpen, setTableOpen] = useState(false);
    const [q, setQ] = useState('');
    const [focus, setFocus] = useState(false);
    const [searchW, setSearchW] = useState(0);

    const go = (name, params) => { if (navRef && navRef.isReady()) navRef.navigate(name, params); };
    const goTab = (tab) => go(preview ? 'CustomerPreview' : 'MainTabs', { screen: tab });
    const search = (text) => { const v = String(text || '').trim(); go('Search', v ? { voice: v, n: Date.now() } : undefined); };
    const voice = useWebVoice((t) => { setQ(t); search(t); });

    // what the shop switched on
    const tabs = full.tabs || [];
    const hasOrders = tabs.includes('orders');
    const hasSearch = tabs.includes('search') || (config.blocks || []).includes('search');
    const couponsOn = !!full.offers?.couponsEnabled;
    const vegToggleOn = !!full.features?.vegToggle && config.foodMode === 'mixed';
    const modes = modesOf(full);
    const effMode = modes.length > 1 ? (modes.includes(mode) ? mode : modes[0]) : (modes[0] || 'delivery');
    const onMode = (m) => { setMode(m); if (m === 'dine_in' && !table) setTableOpen(true); };

    const sample = useMemo(() => {
        const all = menuCats.flatMap((c) => c.items || []);
        const pick = all.find((i) => i.isBestseller) || all[0];
        return pick?.name || '';
    }, [menuCats]);

    // the "where" pill
    let where = null;
    if (effMode === 'dine_in') where = { icon: 'restaurant', cap: tr('Dining at'), main: table ? tr('Table {n}', { n: table }) : tr('Choose your table'), onPress: () => setTableOpen(true) };
    else if (effMode === 'pickup') where = { icon: 'bag-handle', cap: tr('Pickup'), main: tr('Collect it from the shop'), onPress: null };
    else if (user) where = { icon: 'location-sharp', cap: `${tr('Deliver to')} ${addr ? tr(addr.label) : ''}`.trim(), main: addr ? [addr.line1, addr.line2 || addr.city].filter(Boolean).join(', ') : tr('Select delivery address'), onPress: () => setAddrOpen(true) };

    // The placeholder is the longest wording that fits the room the text really has (the box minus its icon, the mic and the clear button), so it is
    // never cut off or hidden: Search "Paneer Tikka"  >  Search dishes  >  Search
    const room = searchW - 46 - (voice.supported ? 32 : 0) - (q ? 26 : 0);
    const wordings = [sample ? tr('Search "{dish}"', { dish: sample }) : tr('Search for dishes'), tr('Search dishes'), tr('Search')];
    const placeholder = searchW ? (wordings.find((t) => t.length * 7.6 <= room) || wordings[wordings.length - 1]) : wordings[0];
    const roomy = width >= 1280;
    const floating = theme.tabBarStyle === 'floating';   // the shop chose the floating bar: on the website it is a pill that floats above the page
    const logo = theme.icon || theme.logo;
    const initial = String(user?.name || user?.phone || '?').trim().slice(0, 1).toUpperCase();

    return (
        <View style={floating ? { backgroundColor: brand.background, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 20, zIndex: 30 } : { backgroundColor: brand.surface, borderBottomWidth: 1, borderBottomColor: brand.border, zIndex: 30 }}>
            <View
                style={[
                    { width: '100%', flexDirection: 'row', alignItems: 'center', height: HEIGHT, paddingHorizontal: 20 },
                    floating && {
                        height: HEIGHT - 2, paddingHorizontal: 18, borderRadius: 34, borderWidth: 1, borderColor: brand.border, backgroundColor: /^#[0-9a-fA-F]{6}$/.test(brand.surface || '') ? `${brand.surface}EB` : brand.surface,
                        backdropFilter: 'blur(18px)', boxShadow: `0 14px 40px rgba(0,0,0,0.16), 0 2px 0 ${brand.primary}33`,
                    },
                ]}
            >
                {/* brand: the logo and the name on up to two lines */}
                <Pressable onPress={() => goTab('Home')} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 16, cursor: 'pointer' }} accessibilityLabel={theme.name || 'Home'}>
                    {logo ? <Image source={logo} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: brand.background }} contentFit="cover" /> : null}
                    {roomy || !logo ? <Text numberOfLines={2} style={{ color: brand.text, fontSize: 15, lineHeight: 18, fontWeight: '900', marginLeft: logo ? 10 : 0, maxWidth: 150 }}>{theme.name || 'Shop'}</Text> : null}
                </Pressable>

                {/* where: a bordered pill */}
                {where ? (
                    <Pressable
                        onPress={where.onPress || undefined}
                        disabled={!where.onPress}
                        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', maxWidth: 250, minWidth: 120, flexShrink: 1, marginRight: 14, height: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: hovered && where.onPress ? brand.muted : brand.border, cursor: where.onPress ? 'pointer' : 'default' })}
                    >
                        <Ionicons name={where.icon} size={18} color={brand.primary} />
                        <View style={{ marginLeft: 8, flexShrink: 1 }}>
                            <Text numberOfLines={1} style={{ color: brand.muted, fontSize: 11, lineHeight: 13 }}>{where.cap}</Text>
                            <Text numberOfLines={1} style={{ color: brand.text, fontSize: 13, lineHeight: 16, fontWeight: '800' }}>{where.main}</Text>
                        </View>
                        {where.onPress ? <Ionicons name="chevron-down" size={15} color={brand.muted} style={{ marginLeft: 8 }} /> : null}
                    </Pressable>
                ) : null}

                {/* search: takes the room that is left */}
                {hasSearch ? (
                    <View onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w && w !== searchW) setSearchW(w); }} style={{ flex: 1, minWidth: 230, height: 42, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, borderRadius: 21, overflow: 'hidden', backgroundColor: brand.background, borderWidth: 1.5, borderColor: focus ? brand.primary : brand.border }}>
                        <Ionicons name="search" size={17} color={brand.primary} />
                        <TextInput
                            value={q}
                            onChangeText={setQ}
                            onFocus={() => setFocus(true)}
                            onBlur={() => setFocus(false)}
                            onSubmitEditing={() => search(q)}
                            returnKeyType="search"
                            placeholder={placeholder}
                            placeholderTextColor={brand.muted}
                            style={{ flex: 1, minWidth: 0, height: '100%', marginLeft: 9, fontSize: 14, color: brand.text, outlineStyle: 'none', outlineWidth: 0 }}
                        />
                        {q ? (
                            <Pressable onPress={() => setQ('')} hitSlop={8} style={{ padding: 4, cursor: 'pointer' }}><Ionicons name="close-circle" size={17} color={brand.muted} /></Pressable>
                        ) : null}
                        {voice.supported ? (
                            <Pressable onPress={voice.start} hitSlop={6} accessibilityLabel={tr('Search by voice')} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: voice.on ? brand.primary : 'transparent', cursor: 'pointer' }}>
                                <Ionicons name={voice.on ? 'mic' : 'mic-outline'} size={17} color={voice.on ? brand.onPrimary || '#FFFFFF' : brand.muted} />
                            </Pressable>
                        ) : null}
                    </View>
                ) : <View style={{ flex: 1 }} />}

                {/* the veg switch sits BESIDE the search box (like the phone), so it can never take the box's room or push the placeholder out */}
                {vegToggleOn ? <View style={{ marginLeft: 8, flexShrink: 0 }}><VegToggle on={veg} onSet={setVeg} brand={brand} /></View> : null}

                {/* delivery | pickup | dine in: only when the shop offers more than one */}
                {modes.length > 1 ? <ModeSwitch modes={modes} value={effMode} onChange={onMode} brand={brand} compact={width < 1280} /> : null}

                <View style={{ marginLeft: 6, flexDirection: 'row', alignItems: 'center' }}>
                    {couponsOn ? <IconBtn brand={brand} icon="pricetags-outline" label={tr('Offers')} onPress={() => go('Offers')} active={routeName === 'Offers'} /> : null}
                    {hasOrders ? <IconBtn brand={brand} icon="receipt-outline" label={tr('Orders')} onPress={() => goTab('Orders')} active={routeName === 'Orders'} /> : null}
                    {user ? <IconBtn brand={brand} icon="notifications-outline" label={tr('Notifications')} onPress={() => go('Notifications')} badge={unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null} active={routeName === 'Notifications'} /> : null}
                    {/* the cart button grows in (and shrinks away) instead of popping, so the bar never jerks when the cart fills or empties */}
                    <View pointerEvents={cartCount > 0 ? 'auto' : 'none'} style={{ width: cartCount > 0 ? 48 : 0, opacity: cartCount > 0 ? 1 : 0, transform: [{ scale: cartCount > 0 ? 1 : 0.6 }], transitionProperty: 'width, opacity, transform', transitionDuration: '320ms', transitionTimingFunction: 'cubic-bezier(0.22, 0.8, 0.2, 1)' }}>
                        <IconBtn brand={brand} icon="bag-handle-outline" label={tr('Cart')} onPress={() => go('Cart')} badge={cartShown > 99 ? '99+' : String(cartShown)} active={routeName === 'Cart'} />
                    </View>
                    {user ? (
                        <Pressable onPress={() => goTab('Account')} accessibilityLabel={tr('Account')} style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, marginLeft: 8, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', opacity: hovered ? 0.88 : 1, borderWidth: routeName === 'Account' ? 2 : 0, borderColor: brand.primary, cursor: 'pointer' })}>
                            {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Text style={{ color: brand.onPrimary || '#FFFFFF', fontWeight: '900', fontSize: 15 }}>{initial}</Text>}
                        </Pressable>
                    ) : (
                        <Pressable onPress={() => go('Login')} style={({ hovered }) => ({ height: 40, paddingHorizontal: 20, borderRadius: 20, marginLeft: 10, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center', opacity: hovered ? 0.88 : 1, cursor: 'pointer' })}>
                            <Text style={{ color: brand.onPrimary || '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{tr('Log in')}</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            <AddressSheet
                visible={addrOpen}
                onClose={() => setAddrOpen(false)}
                selectedId={addr?._id}
                onSelect={(a) => useAddressStore.getState().setSelected(a)}
                onChanged={(items) => useAddressStore.getState().sync(items)}
            />
            <TableSheet visible={tableOpen} onClose={() => setTableOpen(false)} />
        </View>
    );
}
