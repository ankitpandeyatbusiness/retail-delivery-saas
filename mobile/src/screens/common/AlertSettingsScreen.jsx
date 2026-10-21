// Alerts: for every kind of alert, three switches: a notification on the phone, a popup in the app, a sound (with a "Listen" to hear it).
// The same screen for the shop owner, the rider, the cook and the waiter; the groups come from the server for the person's job.
// "Recommended settings" puts everything back as it was given.
import React, { useEffect } from 'react';
import { View, Text, Switch, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Button, Pill } from '../../components/owners/ui';
import { themedAlert } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { useAlertPrefs } from '../../store/common/useAlertPrefs';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { sayExample } from '../../utils/owners/soundbox';
import { tr } from '../../i18n';

function SwitchRow({ title, subtitle, value, onChange, extra }) {
    const { text, muted, primary, border } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{subtitle}</Text>
                {extra}
            </View>
            <Switch value={value} onValueChange={onChange} trackColor={{ true: alpha(primary, 0.5), false: border }} thumbColor={value ? primary : muted} />
        </View>
    );
}

export default function AlertSettingsScreen() {
    const { background, text, muted, ok, warn, primary } = useBrand();
    const nav = useNavigation();
    const { groups, loaded, load, change, reset } = useAlertPrefs();
    const language = useSoundboxStore((s) => s.language);
    useEffect(() => { load(); }, [load]);

    const flip = (g, k, v) => {
        const save = async () => { if (!(await change(g.id, { [k]: v }))) showToast(tr('Could not save. Try again.')); };
        // a missed one costs money or safety: ask once before switching it off
        if (!v && g.critical && k !== 'p') {
            themedAlert(tr('Switch off {name}?', { name: g.label }), tr('You may miss it. This alert is important for your work.'), [
                { text: tr('Keep it on'), style: 'cancel' },
                { text: tr('Switch off'), style: 'destructive', onPress: save },
            ], { icon: 'alert-circle-outline' });
        } else save();
    };
    const recommended = () => themedAlert(tr('Use the recommended settings?'), tr('Every alert goes back to how it was given to you.'), [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Use recommended'), onPress: async () => { showToast((await reset()) ? tr('Recommended settings are on') : tr('Could not save. Try again.')); } },
    ], { icon: 'sparkles-outline' });
    const changed = groups.some((g) => ['n', 'p', 's'].some((k) => g.can[k] && g.pref[k] !== g.defaults[k]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Alerts')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <Card style={{ marginTop: 8 }}>
                    <Text style={{ color: muted, fontSize: 13 }}>{tr('Choose how each alert reaches you. Notification: shows on the phone, even when the app is closed. Popup: opens over the app. Sound: rings and speaks.')}</Text>
                    <Button label={changed ? tr('Use recommended settings') : tr('You are on the recommended settings')} icon="sparkles" kind={changed ? 'primary' : 'ghost'} disabled={!changed} onPress={recommended} style={{ marginTop: 12 }} />
                </Card>
                {!loaded ? <Text style={{ color: muted, textAlign: 'center', marginTop: 24 }}>{tr('Loading…')}</Text> : null}
                {groups.map((g) => (
                    <View key={g.id}>
                        <Card style={{ marginTop: 12 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }}>{tr(g.label)}</Text>
                                {g.critical ? <Pill label={tr('Important')} color={warn} icon="alert-circle" /> : null}
                            </View>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2, marginBottom: 4 }}>{tr(g.hint)}</Text>
                            <SwitchRow title={tr('Notification')} subtitle={tr('Shows on the phone')} value={g.pref.n} onChange={(v) => flip(g, 'n', v)} />
                            {g.can.p ? <SwitchRow title={tr('Popup')} subtitle={tr('Opens over the app')} value={g.pref.p} onChange={(v) => flip(g, 'p', v)} /> : null}
                            {g.can.s ? (
                                <SwitchRow
                                    title={tr('Sound')} subtitle={tr('Rings and speaks')} value={g.pref.s} onChange={(v) => flip(g, 's', v)}
                                    extra={g.sample ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                                            <Button label={tr('Listen')} icon="volume-high" kind="ghost" onPress={() => sayExample(g.id, g.sample)} />
                                            <Text style={{ color: muted, fontSize: 12, marginLeft: 10, flex: 1 }} onPress={() => nav.navigate('Soundbox')}>
                                                {language === 'hi' ? 'हिन्दी' : 'English'} · {tr('Change voice')}
                                            </Text>
                                        </View>
                                    ) : null}
                                />
                            ) : null}
                        </Card>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}
