// Refer a friend: my code to share, how my friends are doing, and a place to type a friend's code (new guests only).
import React, { useCallback, useState } from 'react';
import { Share, Text, TextInput, View, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Button, Stat } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { fetchReferral, applyReferralCode } from '../../api/customers/shopApi';
import { showToast } from '../../components/customers/shop';
import { copyCode } from '../../components/common/copyCode';
import { useCustomerDesktop } from '../../utils/common/layout';
import { DeskPage, DeskHeader, DeskBtn, DESK_T } from '../../components/common/DeskPage';
import { tr } from '../../i18n';

export default function ReferFriendScreen() {
    const { background, text, muted, border, surface, primary, ok, primaryLight, primaryDark, onPrimary } = useBrand();
    const desk = useCustomerDesktop();   // the desktop website (a wide browser): a two-column page. False in the phone app.
    const shop = useHomeStore((s) => s.full.restaurant?.name) || '';
    const [r, setR] = useState(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => { fetchReferral().then(setR).catch((e) => { setR({ on: false }); showToast(e?.response?.data?.error || tr('Could not load')); }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const share = () => Share.share({ message: tr('Eat at {shop} and get {p}% off your first table order. Open the {shop} app, go to Account, Refer a friend and enter my code: {code}', { shop, p: r.friendPercent, code: r.code }) }).catch(() => { });
    const apply = async () => {
        setBusy(true);
        try { await applyReferralCode(code.trim()); showToast(tr('Done! Your first table order gets the friend offer.')); setCode(''); load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not use this code')); } finally { setBusy(false); }
    };
    if (desk) {
        if (!r) return <DeskPage maxWidth={1060}><DeskHeader title={tr('Refer a friend')} /><View style={{ marginTop: 20 }}><ListShimmer count={3} /></View></DeskPage>;
        if (!r.on) return <DeskPage maxWidth={1060}><DeskHeader title={tr('Refer a friend')} /><Text style={{ color: muted, textAlign: 'center', padding: 60, fontSize: 15 }}>{tr('This shop is not running a refer a friend offer right now.')}</Text></DeskPage>;
        const heroBtn = (label, icon, onPress, filled) => (
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                style={({ hovered }) => ({
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, paddingHorizontal: 24, borderRadius: 24, borderWidth: filled ? 0 : 1.5, borderColor: 'rgba(255,255,255,0.7)',
                    backgroundColor: filled ? (hovered ? '#FFFFFF' : 'rgba(255,255,255,0.94)') : hovered ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)', cursor: 'pointer', ...DESK_T,
                })}
            >
                <Ionicons name={icon} size={18} color={filled ? primary : onPrimary} />
                <Text style={{ color: filled ? primary : onPrimary, fontSize: 14.5, fontWeight: '900', marginLeft: 8 }}>{label}</Text>
            </Pressable>
        );
        const stat = (icon, label, value, color) => (
            <View style={{ flex: 1, alignItems: 'center', padding: 18, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: background }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(color || primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={19} color={color || primary} /></View>
                <Text style={{ color: color || text, fontSize: 30, fontWeight: '900', marginTop: 10 }}>{value}</Text>
                <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginTop: 2, textAlign: 'center' }}>{label}</Text>
            </View>
        );
        return (
            <DeskPage maxWidth={1060}>
                <DeskHeader title={tr('Refer a friend')} subtitle={tr('Your friend gets {p}% off. You get {n} points.', { p: r.friendPercent, n: r.points })} />
                <View style={{ flexDirection: 'row', gap: 28, alignItems: 'flex-start', marginTop: 24 }}>
                    {/* LEFT: my code */}
                    <LinearGradient colors={[primaryLight, primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1.15, borderRadius: 26, padding: 34, overflow: 'hidden' }}>
                        <View style={{ position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                        <View style={{ position: 'absolute', bottom: -70, left: 30, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.07)' }} />
                        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="gift" size={32} color={onPrimary} />
                        </View>
                        <Text style={{ color: onPrimary, fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: -0.5, marginTop: 20 }}>{tr('Your friend gets {p}% off. You get {n} points.', { p: r.friendPercent, n: r.points })}</Text>
                        <Text style={{ color: onPrimary, opacity: 0.9, fontSize: 14.5, lineHeight: 21, marginTop: 10 }}>{tr('The offer is for their first table order{max}. You get your points when that first meal is paid.', { max: r.friendMax > 0 ? ` (up to ₹${r.friendMax})` : '' })}</Text>
                        <View style={{ alignSelf: 'flex-start', marginTop: 26, paddingVertical: 14, paddingHorizontal: 30, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)', borderStyle: 'dashed' }}>
                            <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 40, letterSpacing: 8 }}>{r.code}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 22 }}>
                            {heroBtn(tr('Copy code'), 'copy-outline', () => copyCode(r.code), false)}
                            {heroBtn(tr('Share my code'), 'share-social', share, true)}
                        </View>
                    </LinearGradient>

                    {/* RIGHT: how it is going, and a friend's code */}
                    <View style={{ flex: 1 }}>
                        <View style={{ padding: 20, borderRadius: 20, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16, marginBottom: 14 }}>{tr('How it is going')}</Text>
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                {stat('people-outline', tr('Friends joined'), String(r.joined))}
                                {stat('restaurant-outline', tr('Had a first meal'), String(r.rewarded))}
                                {stat('star-outline', tr('Points earned'), String(r.earned), ok)}
                            </View>
                        </View>
                        {r.canApply ? (
                            <View style={{ marginTop: 16, padding: 20, borderRadius: 20, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr("Have a friend's code?")}</Text>
                                <Text style={{ color: muted, fontSize: 13.5, marginTop: 3 }}>{tr('Enter it before your first order to get the friend offer.')}</Text>
                                <TextInput
                                    value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoCapitalize="characters" placeholder={tr('ABC123')} placeholderTextColor={muted} maxLength={6}
                                    style={{ marginTop: 14, borderWidth: 1.5, borderColor: border, backgroundColor: background, color: text, borderRadius: 14, paddingHorizontal: 16, height: 52, fontWeight: '900', letterSpacing: 4, fontSize: 18, outlineStyle: 'none', outlineWidth: 0 }}
                                />
                                <View style={{ marginTop: 12 }}><DeskBtn label={tr('Use this code')} icon="checkmark" busy={busy} disabled={code.length !== 6} onPress={apply} grow /></View>
                            </View>
                        ) : r.applied ? (
                            <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                <Ionicons name="checkmark-circle" size={24} color={ok} />
                                <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 12, lineHeight: 20 }}>{tr("You are using a friend's code. Your first table order gets the friend offer.")}</Text>
                            </View>
                        ) : null}
                    </View>
                </View>
            </DeskPage>
        );
    }
    if (!r) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Refer a friend')} /><ListShimmer count={3} /></View>;
    if (!r.on) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Refer a friend')} /><Text style={{ color: muted, textAlign: 'center', padding: 40 }}>{tr('This shop is not running a refer a friend offer right now.')}</Text></View>;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Refer a friend')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
                <Card>
                    <View style={{ alignItems: 'center', paddingVertical: 6 }}>
                        <Ionicons name="gift" size={40} color={primary} />
                        <Text style={{ color: text, fontWeight: '900', fontSize: 18, textAlign: 'center', marginTop: 8 }}>{tr('Your friend gets {p}% off. You get {n} points.', { p: r.friendPercent, n: r.points })}</Text>
                        <Text style={{ color: muted, textAlign: 'center', marginTop: 6, fontSize: 12.5 }}>{tr('The offer is for their first table order{max}. You get your points when that first meal is paid.', { max: r.friendMax > 0 ? ` (up to ₹${r.friendMax})` : '' })}</Text>
                        <View style={{ marginTop: 14, paddingVertical: 12, paddingHorizontal: 26, borderRadius: 14, backgroundColor: alpha(primary, 0.12), borderWidth: 1.5, borderColor: primary, borderStyle: 'dashed' }}>
                            <Text style={{ color: primary, fontWeight: '900', fontSize: 28, letterSpacing: 4 }}>{r.code}</Text>
                        </View>
                        <Button label={tr('Share my code')} icon="share-social" onPress={share} style={{ alignSelf: 'stretch', marginTop: 16 }} />
                    </View>
                </Card>
                <Card>
                    <View style={{ flexDirection: 'row' }}>
                        <Stat label={tr('Friends joined')} value={String(r.joined)} />
                        <Stat label={tr('Had a first meal')} value={String(r.rewarded)} />
                        <Stat label={tr('Points earned')} value={String(r.earned)} color={ok} />
                    </View>
                </Card>
                {r.canApply ? (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900' }}>{tr("Have a friend's code?")}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Enter it before your first order to get the friend offer.')}</Text>
                        <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoCapitalize="characters" placeholder={tr('ABC123')} placeholderTextColor={muted} maxLength={6}
                            style={{ marginTop: 10, borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 12, padding: 12, fontWeight: '900', letterSpacing: 3, fontSize: 16 }} />
                        <Button label={tr('Use this code')} icon="checkmark" busy={busy} disabled={code.length !== 6} onPress={apply} style={{ marginTop: 10 }} />
                    </Card>
                ) : r.applied ? (
                    <Card><Text style={{ color: text, fontWeight: '800' }}>{tr("You are using a friend's code. Your first table order gets the friend offer.")}</Text></Card>
                ) : null}
            </ScrollView>
        </View>
    );
}
