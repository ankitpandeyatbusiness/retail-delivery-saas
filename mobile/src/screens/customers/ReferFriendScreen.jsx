// Refer a friend: my code to share, how my friends are doing, and a place to type a friend's code (new guests only).
import React, { useCallback, useState } from 'react';
import { Share, Text, TextInput, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Button, Stat } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { fetchReferral, applyReferralCode } from '../../api/customers/shopApi';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

export default function ReferFriendScreen() {
    const { background, text, muted, border, surface, primary, ok } = useBrand();
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
                        <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoCapitalize="characters" placeholder="ABC123" placeholderTextColor={muted} maxLength={6}
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
