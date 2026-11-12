// Alerts: for every kind of alert, four switches side by side: Notification, Tone, Voice, Slider (and a small "Listen"). The same screen for the shop owner, the
// rider, the cook and the waiter; the groups come from the server for the person's job. "Recommended settings" puts everything back as it was given.
import { usePlanHas } from '../../utils/owners/menuFlags';
import React, { useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Button, Pill, Chips } from '../../components/owners/ui';
import SlideSwitch from '../../components/common/SlideSwitch';
import { themedAlert } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import BrowserPushCard from '../../components/common/BrowserPushCard';
import { useAlertPrefs } from '../../store/common/useAlertPrefs';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { sayExample } from '../../utils/owners/soundbox';
import { ListShimmer } from '../../components/owners/shimmer';
import { UpgradeNote } from '../../components/owners/PlanLock';
import { useIsDesktopWeb, useOwnerDesktop, useStaffDesktop } from '../../utils/common/layout';
import { Hero, HeroBtn } from '../../components/owners/RiderDesk';
import { DeskPage, DeskHeader, DeskBtn, DESK_T } from '../../components/common/DeskPage';
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
    const { background, text, muted, warn, primary, border, surface } = useBrand();
    const nav = useNavigation();
    const ownDesk = useOwnerDesktop();
    const staffDesk = useStaffDesktop();   // the cook and the waiter on a computer get the owner's look too
    const ownerDesk = ownDesk || staffDesk;
    const desk = useIsDesktopWeb();   // a browser at least 1024 px wide: the alerts as a grid of cards (false in the phone app)
    const { groups, loaded, load, change, reset } = useAlertPrefs();
    const language = useSoundboxStore((s) => s.language);
    const planVoice = usePlanHas('soundboxVoice');
    const web = Platform.OS === 'web';   // the website has no tone and no voice (a browser cannot ring or read out reliably): those switches are not shown there
    const voiceOk = planVoice;   // Soundbox voice is Growth and Pro: on Partner there is the sound, tone and slider only
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
    const withVoice = groups.some((g) => g.can.v || g.can.p);
    const changed = groups.some((g) => ['n', 'p', 's', 'v'].some((k) => g.can[k] && g.pref[k] !== g.defaults[k]) || g.pref.sec !== g.defaults.sec);

    if (desk) {
        const intro = web ? tr('Notification shows on this browser (switch it on below). Slider shows on the screen while the website is open.') : withVoice ? tr('Notification shows on the phone, even when the app is closed. Tone is its sound. Voice reads it out while the app is open. Slider is the box that slides up over the app.') : tr('Notification shows on the phone, even when the app is closed. Tone is its sound.');
        const rows = [];
        for (let i = 0; i < groups.length; i += 2) rows.push(groups.slice(i, i + 2));
        return (
            <DeskPage maxWidth={ownerDesk ? 1180 : 1060}>
                {ownerDesk ? (
                    <View style={{ marginHorizontal: -16 }}><Hero icon="notifications" title={tr('Alerts')} subtitle={intro} right={<><HeroBtn icon="arrow-back" label={tr('Back')} onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('MainTabs'))} /><HeroBtn solid={changed} icon="sparkles" label={changed ? tr('Use recommended settings') : tr('You are on the recommended settings')} onPress={changed ? recommended : undefined} /></>} /></View>
                ) : (
                <>
                <DeskHeader
                    title={tr('Alerts')}
                    right={<DeskBtn kind={changed ? 'primary' : 'ghost'} icon="sparkles" label={changed ? tr('Use recommended settings') : tr('You are on the recommended settings')} disabled={!changed} onPress={recommended} />}
                />
                <Text style={{ color: muted, fontSize: 14, lineHeight: 21, marginTop: 14, maxWidth: 780 }}>{intro}</Text>
                </>
                )}
                {/* the website only: "Also notify me on this browser" */}
                <View style={{ marginHorizontal: -16, marginTop: 6 }}><BrowserPushCard /></View>
                {loaded && !voiceOk && !web ? <View style={{ marginHorizontal: -16 }}><UpgradeNote feature="soundboxVoice" text={tr('Soundbox voice announces every new order')} /></View> : null}
                {!loaded ? <ListShimmer count={5} /> : null}
                <View style={{ gap: 16, marginTop: 14 }}>
                    {rows.map((r, ri) => (
                        <View key={ri} style={{ flexDirection: 'row', gap: 16 }}>
                            {[0, 1].map((ci) => {
                                const g = r[ci];
                                if (!g) return <View key={ci} style={{ flex: 1 }} />;
                                return (
                                    <Pressable
                                        key={g.id}
                                        style={({ hovered }) => ({ flex: 1, padding: 20, borderRadius: 18, borderWidth: 1, borderColor: hovered ? `${primary}66` : border, backgroundColor: surface, boxShadow: hovered ? `0 10px 28px ${primary}1F` : '0 0 0 rgba(0,0,0,0)', ...DESK_T })}
                                    >
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={1}>{tr(g.label)}</Text>
                                            {g.critical ? <Pill label={tr('Important')} color={warn} icon="alert-circle" /> : null}
                                        </View>
                                        <Text style={{ color: muted, fontSize: 13, marginTop: 3, lineHeight: 18 }} numberOfLines={2}>{tr(g.hint)}</Text>
                                        <View style={{ flexDirection: 'row', marginTop: 16 }}>
                                            <Col label={tr('Notification')} value={g.pref.n} onChange={(v) => flip(g, 'n', v)} />
                                            {g.can.s && !web ? <Col label={tr('Tone')} value={g.pref.s} onChange={(v) => flip(g, 's', v)} /> : null}
                                            {g.can.v && voiceOk && !web ? <Col label={tr('Voice')} value={g.pref.v} onChange={(v) => flip(g, 'v', v)} /> : null}
                                            {g.can.p ? <Col label={tr('Slider')} value={g.pref.p} onChange={(v) => flip(g, 'p', v)} /> : null}
                                        </View>
                                        {g.can.p && g.pref.p ? (
                                            <View style={{ marginTop: 12 }}>
                                                <Text style={{ color: muted, fontSize: 12, fontWeight: '800' }}>{tr('Slider stays for')}</Text>
                                                <Chips options={[[0, tr('Until I close it')], [3, tr('3 s')], [5, tr('5 s')], [7, tr('7 s')], [10, tr('10 s')], [15, tr('15 s')]]} value={g.pref.sec} onChange={(v) => flip(g, 'sec', v)} style={{ marginTop: 6, marginBottom: -4 }} />
                                            </View>
                                        ) : null}
                                        {g.sample && !web ? (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: border }}>
                                                <Pressable onPress={() => sayExample(g.id, g.sample, g.soft)} hitSlop={8} accessibilityRole="button" style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', opacity: hovered ? 0.7 : 1, cursor: 'pointer', ...DESK_T })}>
                                                    <Ionicons name="volume-high" size={18} color={primary} />
                                                    <Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Listen')}</Text>
                                                </Pressable>
                                                <Pressable onPress={() => nav.navigate('Soundbox')} hitSlop={8} style={({ hovered }) => ({ marginLeft: 'auto', opacity: hovered ? 0.7 : 1, cursor: 'pointer', ...DESK_T })}>
                                                    <Text style={{ color: muted, fontSize: 12.5 }}>{({ hi: 'हिन्दी', mr: 'मराठी', gu: 'ગુજરાતી', bn: 'বাংলা' })[language] || tr('English')} · {tr('Change voice')}</Text>
                                                </Pressable>
                                            </View>
                                        ) : null}
                                    </Pressable>
                                );
                            })}
                        </View>
                    ))}
                </View>
            </DeskPage>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Alerts')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 }}>
                    <Text style={{ color: muted, fontSize: 12.5, lineHeight: 18 }}>{web ? tr('Notification shows on this browser (switch it on below). Slider shows on the screen while the website is open.') : withVoice ? tr('Notification shows on the phone, even when the app is closed. Tone is its sound. Voice reads it out while the app is open. Slider is the box that slides up over the app.') : tr('Notification shows on the phone, even when the app is closed. Tone is its sound.')}</Text>
                    <Button label={changed ? tr('Use recommended settings') : tr('You are on the recommended settings')} icon="sparkles" kind={changed ? 'primary' : 'ghost'} disabled={!changed} onPress={recommended} style={{ marginTop: 10 }} />
                </View>
                {/* the website only: "Also notify me on this browser" */}
                <BrowserPushCard />
                {loaded && !voiceOk && !web ? <UpgradeNote feature="soundboxVoice" text={tr('Soundbox voice announces every new order')} /> : null}
                {!loaded ? <ListShimmer count={5} /> : null}
                {groups.map((g) => (
                    <Card key={g.id} style={{ marginTop: 8, paddingVertical: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 15, flex: 1 }} numberOfLines={1}>{tr(g.label)}</Text>
                            {g.critical ? <Pill label={tr('Important')} color={warn} icon="alert-circle" /> : null}
                        </View>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{tr(g.hint)}</Text>
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <Col label={tr('Notification')} value={g.pref.n} onChange={(v) => flip(g, 'n', v)} />
                            {g.can.s && !web ? <Col label={tr('Tone')} value={g.pref.s} onChange={(v) => flip(g, 's', v)} /> : null}
                            {g.can.v && voiceOk && !web ? <Col label={tr('Voice')} value={g.pref.v} onChange={(v) => flip(g, 'v', v)} /> : null}
                            {g.can.p ? <Col label={tr('Slider')} value={g.pref.p} onChange={(v) => flip(g, 'p', v)} /> : null}
                        </View>
                        {g.can.p && g.pref.p ? (
                            <View style={{ marginTop: 8 }}>
                                <Text style={{ color: muted, fontSize: 11.5, fontWeight: '800' }}>{tr('Slider stays for')}</Text>
                                <Chips options={[[0, tr('Until I close it')], [3, tr('3 s')], [5, tr('5 s')], [7, tr('7 s')], [10, tr('10 s')], [15, tr('15 s')]]} value={g.pref.sec} onChange={(v) => flip(g, 'sec', v)} style={{ marginTop: 6, marginBottom: -4 }} />
                            </View>
                        ) : null}
                        {g.sample && !web ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: border }}>
                                <Pressable onPress={() => sayExample(g.id, g.sample, g.soft)} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Ionicons name="volume-high" size={18} color={primary} />
                                    <Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{tr('Listen')}</Text>
                                </Pressable>
                                <Pressable onPress={() => nav.navigate('Soundbox')} hitSlop={8} style={{ marginLeft: 'auto' }}>
                                    <Text style={{ color: muted, fontSize: 12 }}>{({ hi: 'हिन्दी', mr: 'मराठी', gu: 'ગુજરાતી', bn: 'বাংলা' })[language] || tr('English')} · {tr('Change voice')}</Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </Card>
                ))}
            </ScrollView>
        </View>
    );
}
