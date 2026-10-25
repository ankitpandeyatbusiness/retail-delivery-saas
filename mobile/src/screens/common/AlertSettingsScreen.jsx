// Alerts: for every kind of alert, four switches side by side: Notification, Tone, Voice, Slider (and a small "Listen"). The same screen for the shop owner, the
// rider, the cook and the waiter; the groups come from the server for the person's job. "Recommended settings" puts everything back as it was given.
import React, { useEffect } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Button, Pill, Chips } from '../../components/owners/ui';
import SlideSwitch from '../../components/common/SlideSwitch';
import { themedAlert } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { useAlertPrefs } from '../../store/common/useAlertPrefs';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { sayExample } from '../../utils/owners/soundbox';
import { tr } from '../../i18n';

// one small column: its name, and the switch under it
function Col({ label, value, onChange }) {
    const { muted } = useBrand();
    return (
        <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: muted, fontSize: 11.5, fontWeight: '800', marginBottom: 6 }}>{label}</Text>
            <SlideSwitch value={value} onValueChange={onChange} accessibilityLabel={label} />
        </View>
    );
}

export default function AlertSettingsScreen() {
    const { background, text, muted, warn, primary, border } = useBrand();
    const nav = useNavigation();
    const { groups, loaded, load, change, reset } = useAlertPrefs();
    const language = useSoundboxStore((s) => s.language);
    useEffect(() => { load(); }, [load]);

    const flip = (g, k, v) => {
        const save = async () => { if (!(await change(g.id, { [k]: v }))) showToast(tr('Could not save. Try again.')); };
        // a missed one costs money or safety: ask once before switching it off
        if (!v && g.critical && k !== 'p' && k !== 'sec') {
            themedAlert(tr('Switch off {name}?', { name: tr(g.label) }), tr('You may miss it. This alert is important for your work.'), [
                { text: tr('Keep it on'), style: 'cancel' },
                { text: tr('Switch off'), style: 'destructive', onPress: save },
            ], { icon: 'alert-circle-outline' });
        } else save();
    };
    const recommended = () => themedAlert(tr('Use the recommended settings?'), tr('Every alert goes back to how it was given to you.'), [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Use recommended'), onPress: async () => { showToast((await reset()) ? tr('Recommended settings are on') : tr('Could not save. Try again.')); } },
    ], { icon: 'sparkles-outline' });
    const changed = groups.some((g) => ['n', 'p', 's', 'v'].some((k) => g.can[k] && g.pref[k] !== g.defaults[k]) || g.pref.sec !== g.defaults.sec);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Alerts')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 }}>
                    <Text style={{ color: muted, fontSize: 12.5, lineHeight: 18 }}>{tr('Notification shows on the phone, even when the app is closed. Tone is its sound. Voice reads it out while the app is open. Slider is the box that slides up over the app.')}</Text>
                    <Button label={changed ? tr('Use recommended settings') : tr('You are on the recommended settings')} icon="sparkles" kind={changed ? 'primary' : 'ghost'} disabled={!changed} onPress={recommended} style={{ marginTop: 10 }} />
                </View>
                {!loaded ? <Text style={{ color: muted, textAlign: 'center', marginTop: 24 }}>{tr('Loading…')}</Text> : null}
                {groups.map((g) => (
                    <Card key={g.id} style={{ marginTop: 8, paddingVertical: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={1}>{tr(g.label)}</Text>
                            {g.critical ? <Pill label={tr('Important')} color={warn} icon="alert-circle" /> : null}
                        </View>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{tr(g.hint)}</Text>
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <Col label={tr('Notification')} value={g.pref.n} onChange={(v) => flip(g, 'n', v)} />
                            {g.can.s ? <Col label={tr('Tone')} value={g.pref.s} onChange={(v) => flip(g, 's', v)} /> : null}
                            {g.can.v ? <Col label={tr('Voice')} value={g.pref.v} onChange={(v) => flip(g, 'v', v)} /> : null}
                            {g.can.p ? <Col label={tr('Slider')} value={g.pref.p} onChange={(v) => flip(g, 'p', v)} /> : null}
                        </View>
                        {g.can.p && g.pref.p ? (
                            <View style={{ marginTop: 8 }}>
                                <Text style={{ color: muted, fontSize: 11.5, fontWeight: '800' }}>{tr('Slider stays for')}</Text>
                                <Chips options={[[0, tr('Until I close it')], [3, '3 s'], [5, '5 s'], [7, '7 s'], [10, '10 s'], [15, '15 s']]} value={g.pref.sec} onChange={(v) => flip(g, 'sec', v)} style={{ marginTop: 6, marginBottom: -4 }} />
                            </View>
                        ) : null}
                        {g.sample ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: border }}>
                                <Pressable onPress={() => sayExample(g.id, g.sample, g.soft)} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons name="volume-high" size={18} color={primary} />
                                    <Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Listen')}</Text>
                                </Pressable>
                                <Pressable onPress={() => nav.navigate('Soundbox')} hitSlop={8} style={{ marginLeft: 'auto' }}>
                                    <Text style={{ color: muted, fontSize: 12 }}>{language === 'hi' ? 'हिन्दी' : 'English'} · {tr('Change voice')}</Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </Card>
                ))}
            </ScrollView>
        </View>
    );
}
