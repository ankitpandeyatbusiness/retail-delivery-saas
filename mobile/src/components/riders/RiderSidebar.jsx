// The rider's panel on a computer (a browser at least 1024 px wide): a left sidebar instead of the floating bottom tabs.
// It looks and works exactly like the owner's and the cook's sidebar (components/owners/OwnerSidebar.jsx, components/staff/StaffSidebar.jsx): a rounded panel
// floating on the page, the shop card on top (a click opens Home), Home (with the number of new orders), History, Money and Profile, a small round button on
// its right edge that folds it to icons, the folded one slides open over the page when the pointer comes onto it, and a click on the button keeps it open.
// Never drawn in the phone app or on a narrow window: DesktopFrame only mounts it when useRiderDesktop() is true.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { useRiderStore } from '../../store/riders/useRiderStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { ShopLogo } from '../owners/ui';
import { tr } from '../../i18n';
import { SideRow, SideGroupTitle } from '../common/SidebarExtras';
import AppearanceSwitch from '../owners/AppearanceSwitch';
import LanguageSheet from '../common/LanguageSheet';
import SosSheet from './SosSheet';
import { themedAlert } from '../common/dialog';
import { useAuthStore } from '../../store/common/useAuthStore';
import { T } from '../../utils/riders/riderText';

const WIDE = 272;
const NARROW = 72;
const KEY = 'rider.sidebar.folded';
const GLIDE = 'cubic-bezier(0.22, 0.8, 0.3, 1)';   // the easing of the slide (width, button, shadow)
const read = () => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const save = (v) => { try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* not saved */ } };

export default function RiderSidebar({ routeName }) {
    const nav = useNavigation();
    const { surface, background, border, text, muted, primary, onPrimary, error, dark } = useBrand();
    const [folded, setFolded] = useState(read);
    const [peek, setPeek] = useState(false);   // folded, but the pointer is on the sidebar: it slides open over the page
    const [langOpen, setLangOpen] = useState(false);
    const [sosOpen, setSosOpen] = useState(false);
    const leaveTimer = useRef(null);
    const rootRef = useRef(null);
    const wide = !folded || peek;              // the panel is (or is sliding to) its full width
    const me = useRiderStore((s) => s.me);
    const offers = useRiderStore((s) => s.offers.length);   // a new order waiting for him
    const missed = useRiderStore((s) => s.missedNew);       // an offer ran out unanswered
    const shop = useThemeStore((s) => s.theme.name);
    const online = !!me?.isOnline;
    const items = [
        ['RiderHomeTab', 'Home', 'bicycle-outline', 'bicycle', offers],
        ['RiderHistoryTab', 'History', 'time-outline', 'time', missed],
        ['RiderMoneyTab', 'Money', 'wallet-outline', 'wallet', 0],
        ['RiderProfileTab', 'Profile', 'person-outline', 'person', 0],
    ];
    // what used to be only on the Profile page, one click away
    const extras = [
        { route: 'RiderDuty', icon: 'calendar-outline', title: tr('Duty and leave') },
        ...(me?.pointsOn !== false ? [{ route: 'RiderPoints', icon: 'ribbon-outline', title: tr('My points and badge') }] : []),
        { route: 'AlertSettings', icon: 'notifications-outline', title: tr('Alerts') },
        { route: 'Soundbox', icon: 'volume-high-outline', title: tr('Soundbox') },
        { route: 'Sessions', icon: 'phone-portrait-outline', title: tr("Where you're logged in") },
        { route: 'AboutUs', icon: 'information-circle-outline', title: tr('About Us') },
        { key: 'lang', icon: 'language-outline', title: tr('Language'), act: () => setLangOpen(true) },
        ...(me?.shopPhone ? [{ key: 'call', icon: 'call-outline', title: tr('Call the shop'), act: () => Linking.openURL(`tel:${me.shopPhone}`).catch(() => { }) }] : []),
        { key: 'sos', icon: 'alert-circle-outline', title: T.sos, color: error, act: () => setSosOpen(true) },
    ];
    const signOut = () => themedAlert(`${T.logout}?`, T.logoutText, [
        { text: T.cancel, style: 'cancel' },
        { text: T.logout, style: 'destructive', onPress: () => { useRiderStore.getState().reset(); useAuthStore.getState().logout().catch(() => { }); } },
    ], { icon: 'log-out-outline' });
    const toggle = () => setFolded((f) => { save(!f); return !f; });
    const go = (name) => nav.navigate('MainTabs', { screen: name });
    const keepOpen = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };
    const hoverIn = () => { keepOpen(); if (folded) setPeek(true); };
    // the folded sidebar opens when the pointer comes onto it ANYWHERE (icons, the empty part, the edge)
    useEffect(() => {
        const box = rootRef.current;
        if (!folded || peek || !box || typeof box.addEventListener !== 'function') return undefined;
        const enter = () => setPeek(true);
        box.addEventListener('mouseenter', enter);
        return () => box.removeEventListener('mouseenter', enter);
    }, [folded, peek]);
    // while it is peeking, watch the pointer: anywhere on the sidebar keeps it open; it closes only after the pointer has been off it for a moment
    useEffect(() => {
        if (!peek || typeof document === 'undefined') return undefined;
        const onMove = (e) => {
            const box = rootRef.current;
            const on = box && typeof box.contains === 'function' && box.contains(e.target);
            if (on) keepOpen();
            else if (!leaveTimer.current) leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setPeek(false); }, 260);
        };
        document.addEventListener('mousemove', onMove);
        return () => { document.removeEventListener('mousemove', onMove); keepOpen(); };
    }, [peek]);   // eslint-disable-line react-hooks/exhaustive-deps
    const pin = () => { keepOpen(); setPeek(false); toggle(); };   // the button: fold it, or (when it is only peeking) keep it open

    const panelW = wide ? WIDE - 14 : NARROW - 14;
    // the two looks of the inside sit on top of each other and cross-fade while the panel's width glides, so nothing jumps
    const layer = (on, width) => ({ position: 'absolute', top: 0, bottom: 0, left: 0, width, opacity: on ? 1 : 0, pointerEvents: on ? 'auto' : 'none', transitionProperty: 'opacity', transitionDuration: '200ms', transitionTimingFunction: 'ease' });

    const inside = (compact) => (
        <>
            <Pressable onPress={() => go('RiderHomeTab')} accessibilityRole="link" accessibilityLabel={tr('Home')} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', margin: compact ? 0 : 12, marginBottom: compact ? 0 : 6, padding: compact ? 0 : 12, paddingVertical: compact ? 16 : 12, borderRadius: 20, backgroundColor: compact ? 'transparent' : alpha(primary, hovered ? 0.16 : 0.09), justifyContent: compact ? 'center' : 'flex-start', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
                <ShopLogo size={compact ? 42 : 46} />
                {compact ? null : (
                    <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                        <Text style={{ color: text, fontSize: 17, fontWeight: '900' }} numberOfLines={1}>{shop || tr('My shop')}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 1, marginBottom: 4 }} numberOfLines={1}>{me?.name || me?.phone || ''}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, backgroundColor: alpha(online ? '#1E8E3E' : muted, 0.16) }}>
                            <View style={{ width: 7, height: 7, borderRadius: 4, marginRight: 6, backgroundColor: online ? '#1E8E3E' : muted }} />
                            <Text style={{ color: online ? '#1E8E3E' : muted, fontSize: 12, fontWeight: '800' }}>{online ? tr('On duty') : tr('Off duty')}</Text>
                        </View>
                    </View>
                )}
            </Pressable>
            <View style={{ paddingHorizontal: compact ? 10 : 12 }}>
                {items.map(([name, label, icon, on, n]) => {
                    const here = routeName === name;
                    return (
                        <Pressable key={name} onPress={() => go(name)} accessibilityRole="button" accessibilityLabel={tr(label)}
                            style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', height: 48, borderRadius: 16, paddingHorizontal: compact ? 0 : 14, marginBottom: 4, cursor: 'pointer', backgroundColor: here ? primary : hovered ? alpha(primary, 0.1) : 'transparent', boxShadow: here ? `0 8px 20px ${alpha(primary, 0.38)}` : '0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                            <View>
                                <Ionicons name={here ? on : icon} size={22} color={here ? onPrimary : text} />
                                {compact && n > 0 ? <View style={{ position: 'absolute', top: -3, right: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: error }} /> : null}
                            </View>
                            {compact ? null : <Text numberOfLines={1} style={{ flex: 1, marginLeft: 14, color: here ? onPrimary : text, fontSize: 15, fontWeight: '800' }}>{tr(label)}</Text>}
                            {!compact && n > 0 ? (
                                <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: here ? onPrimary : error, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ color: here ? primary : '#FFFFFF', fontSize: 12, fontWeight: '900' }}>{n}</Text>
                                </View>
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>
            <View style={{ height: 1, backgroundColor: border, marginHorizontal: 20, marginVertical: 10, opacity: 0.7 }} />
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: compact ? 10 : 12, paddingBottom: 8 }}>
                {compact ? null : <SideGroupTitle>{tr('More')}</SideGroupTitle>}
                {extras.map((e) => <SideRow key={e.key || e.route} icon={e.icon} title={e.title} color={e.color} compact={compact} active={!!e.route && routeName === e.route} onPress={e.act || (() => nav.navigate(e.route))} />)}
                {compact
                    ? <SideRow icon={dark ? 'sunny-outline' : 'moon-outline'} title={tr('Appearance')} compact onPress={() => useThemeStore.getState().setAppearance(dark ? 'light' : 'dark')} />
                    : <AppearanceSwitch last />}
            </ScrollView>
            <View style={{ paddingHorizontal: compact ? 10 : 12, paddingBottom: 14 }}>
                <SideRow icon="log-out-outline" title={tr('Log out')} color={error} compact={compact} onPress={signOut} />
            </View>
        </>
    );

    return (
        // the space the sidebar takes in the page: it follows the saved choice; a peek opens over the page and leaves this alone
        <View ref={rootRef} style={{ width: folded ? NARROW : WIDE, height: '100%', zIndex: 20, transitionProperty: 'width', transitionDuration: '240ms', transitionTimingFunction: GLIDE }}>
            {/* no hard line: the sidebar is a rounded panel that floats on the page with a soft shadow */}
            <Pressable onHoverIn={hoverIn} accessible={false} style={{ position: 'absolute', top: 10, bottom: 10, left: 10, width: panelW, overflow: 'hidden', backgroundColor: surface || background, borderRadius: 26, cursor: 'default', boxShadow: peek ? '0 18px 60px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.06)' : '0 12px 44px rgba(0,0,0,0.09), 0 2px 8px rgba(0,0,0,0.04)', transitionProperty: 'width, box-shadow', transitionDuration: '240ms', transitionTimingFunction: GLIDE }}>
                <View style={layer(wide, WIDE - 14)}>{inside(false)}</View>
                <View style={layer(!wide, NARROW - 14)}>{inside(true)}</View>
            </Pressable>
            {/* the folded sidebar's right edge: the pointer on this thin strip slides the panel open (a line shows where) */}
            {!wide ? (
                <Pressable onHoverIn={hoverIn} onPress={pin} accessible={false} style={{ position: 'absolute', left: NARROW - 14 + 10 - 9, width: 18, top: 10, bottom: 10, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 25 }}>
                    {({ hovered }) => <View style={{ width: 3, height: hovered ? '70%' : '30%', borderRadius: 2, backgroundColor: primary, opacity: hovered ? 0.9 : 0, transitionProperty: 'height, opacity', transitionDuration: '180ms' }} />}
                </Pressable>
            ) : null}
            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
            <SosSheet visible={sosOpen} onClose={() => setSosOpen(false)} shopPhone={me?.shopPhone} />
            {/* the fold button: a small round button on the right edge of the panel, half out of it; it rides the edge while the panel slides */}
            <Pressable onPress={pin} onHoverIn={hoverIn} accessibilityRole="button" accessibilityLabel={folded ? tr('Keep the sidebar open') : tr('Fold the sidebar')}
                style={({ hovered }) => ({ position: 'absolute', left: NARROW - 16, top: 37, transform: [{ translateX: wide ? WIDE - NARROW : 0 }], willChange: 'transform', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: !folded || hovered ? primary : surface, borderWidth: 1, borderColor: !folded || hovered ? primary : border, boxShadow: '0 4px 14px rgba(0,0,0,0.14)', cursor: 'pointer', zIndex: 30, transitionProperty: 'transform, background-color, border-color', transitionDuration: '240ms, 140ms, 140ms', transitionTimingFunction: GLIDE })}>
                {({ hovered }) => <Ionicons name={folded ? (peek ? 'pin' : 'chevron-forward') : 'chevron-back'} size={14} color={!folded || hovered ? onPrimary : muted} />}
            </Pressable>
        </View>
    );
}
