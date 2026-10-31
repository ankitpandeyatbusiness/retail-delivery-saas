// Soundbox settings. These belong to this phone only.
import React, { useEffect, useState } from 'react';
import { View, Text, Switch, ScrollView, Linking, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Button, Pill, Chips, Option } from '../../components/owners/ui';
import { useSoundboxStore, REPEAT_CHOICES } from '../../store/owners/useSoundboxStore';
import { labelledVoices, sampleVoice, previewGreeting } from '../../utils/owners/soundbox';
import { FAITH_GREETINGS, ADDRESS_CHOICES } from '../../utils/owners/greetings';
import { newOrderChannelInfo } from '../../utils/common/push';
import { useAuthStore } from '../../store/common/useAuthStore';
import { LineShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';
import KeyboardScroll from '../../components/common/KeyboardScroll';

const VOLUMES = [[0.4, 'Low'], [0.7, 'Medium'], [1, 'Loud']];
const LANGUAGES = [['en', 'English'], ['hi', 'हिन्दी']];

function Switcher({ title, subtitle, value, onChange }) {
    const { text, muted, primary } = useBrand();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>
            </View>
            <Switch value={value} onValueChange={onChange} trackColor={{ true: alpha(primary, 0.5), false: undefined }} thumbColor={value ? primary : undefined} />
        </View>
    );
}

// a small heading and a hint inside a card
function Label({ title, hint }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ marginBottom: 2 }}>
            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
            {hint ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{hint}</Text> : null}
        </View>
    );
}

export default function SoundboxScreen() {
    const { background, text, muted, ok, border, error } = useBrand();
    const st = useSoundboxStore();
    const hindi = st.language === 'hi';
    const role = useAuthStore((x) => x.user?.role);
    const staff = role === 'kitchen' || role === 'waiter';
    const rider = role === 'rider';   // a rider only chooses the voice, the language and the volume

    const [voices, setVoices] = useState(null);   // [{ voice, name, sub, recommended }] for the chosen language
    useEffect(() => {
        let alive = true;
        setVoices(null);
        labelledVoices(st.language).then((v) => alive && setVoices(v)).catch(() => alive && setVoices([]));
        return () => { alive = false; };
    }, [st.language]);
    const chosenId = (hindi ? st.voiceIdHi : st.voiceId) || voices?.[0]?.voice.identifier;

    const [chan, setChan] = useState(null);   // what the phone holds for the new-order channel (see push.js)
    useEffect(() => {
        // the channel is created when push registers; give that a moment on first open
        const t = setTimeout(() => newOrderChannelInfo(staff ? 'staff_alerts_v1' : undefined).then(setChan), 600);
        return () => clearTimeout(t);
    }, []);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Soundbox')} />
            <KeyboardScroll contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
                <Card style={{ marginTop: 8 }}>
                    <Switcher
                        title={tr('Soundbox mode')}
                        subtitle={role === 'kitchen' ? tr('Rings and reads every new order out loud (the table, the dishes and the guest\'s note) while the app is open. Off means no sound at all on this phone.') : role === 'waiter' ? tr('Rings and says it out loud when food is ready or a table calls, while the app is open. Off means no sound at all on this phone.') : rider ? tr('Says your alerts out loud while the app is open. Off means no voice on this phone.') : tr('Rings and reads every new order out loud while the app is open. With the screen off you get the tone and the notification: tap it to hear the order. Off means no new-order sound at all on this phone.')}
                        value={st.soundbox}
                        onChange={(v) => st.update({ soundbox: v })}
                    />
                    {!st.soundbox ? (
                        <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{tr('Turn Soundbox mode on to change the settings below.')}</Text>
                    ) : null}
                </Card>

                {!rider ? <SectionTitle title={tr('Phone check')} /> : null}
                {!rider ? (
                <Card>
                    <Label title={tr('Is this phone ready for new orders?')} hint={tr('Every line should have a green tick. Fix any red line, then press Check again.')} />
                    <View style={{ marginTop: 10 }}>
                        {!chan ? <LineShimmer width={140} height={14} /> : null}
                        {chan && !chan.supported ? <Text style={{ color: muted, fontSize: 13 }}>{tr('This check is for Android phones.')}</Text> : null}
                        {chan?.supported && chan.error ? <Text style={{ color: error, fontSize: 13 }}>{tr('Could not read it: {error}', { error: chan.error })}</Text> : null}
                        {chan?.supported && !chan.error ? [
                            [chan.allowed, 'Notifications are allowed for this app', 'Phone settings → Apps → this app → Notifications → Allow.'],
                            [chan.exists, staff ? 'The "Staff alerts" channel exists' : 'The "New orders" channel exists', staff ? 'Open the app once while signed in, then press Check again.' : 'Open the app once while logged in as the owner, then press Check again.'],
                            // Android only says "custom" (a sound the app set), "default" (the phone's normal ping, which is
                            // what it falls back to when the sound file is missing from the app) or nothing (silent).
                            [chan.exists && chan.sound === 'custom', `It has the app's own sound, ${staff ? 'the ting-tong' : 'the "New order received" voice'} (now: ${chan.exists ? (chan.sound === 'default' ? "the phone's normal ping" : chan.sound === 'custom' ? 'custom' : 'silent') : '—'})`, chan.sound === 'default'
                                ? 'The app could not find its sound file, so Android used the normal ping. This app build does not contain the sound: install the latest build (uninstall first).'
                                : 'The channel is silent. Uninstall and reinstall the app, or in Phone settings → Apps → this app → Notifications → New orders → Sound.'],
                            [chan.exists && chan.importance >= 4, `It may pop up and make sound (level ${chan.importance ?? '—'} of 5)`, 'Phone settings → Apps → this app → Notifications → New orders → set to "Urgent" or "High".'],
                            [chan.exists && chan.vibration, 'It vibrates', 'Phone settings → Apps → this app → Notifications → New orders → Vibration on.'],
                        ].map(([good, line, fix]) => (
                            <View key={line} style={{ flexDirection: 'row', marginBottom: 10 }}>
                                <Ionicons name={good ? 'checkmark-circle' : 'close-circle'} size={20} color={good ? ok : error} style={{ marginTop: 1, marginRight: 10 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontSize: 14, fontWeight: '700' }}>{line}</Text>
                                    {!good ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{fix}</Text> : null}
                                </View>
                            </View>
                        )) : null}
                    </View>
                    <View style={{ flexDirection: 'row' }}>
                        <Button label={tr('Check again')} kind="ghost" onPress={() => newOrderChannelInfo(staff ? 'staff_alerts_v1' : undefined).then(setChan)} style={{ flex: 1, marginRight: 8 }} />
                        <Button label={tr('Settings')} kind="ghost" onPress={() => Linking.openSettings()} style={{ flex: 1 }} />
                    </View>
                </Card>
                ) : null}

                {/* everything below belongs to Soundbox mode: dimmed and untouchable while it is off */}
                <View pointerEvents={st.soundbox ? 'auto' : 'none'} style={{ opacity: st.soundbox ? 1 : 0.4 }}>
                {!rider ? (
                <Card>
                    <Switcher
                        title={tr('Repeating chime')}
                        subtitle={tr('Rings again and again until you open the order.')}
                        value={st.ring}
                        onChange={(v) => st.update({ ring: v })}
                    />
                </Card>
                ) : null}

                <SectionTitle title={tr('Volume and repeat')} />
                <Card>
                    <Label title={tr('Volume')} />
                    <Chips options={VOLUMES} value={st.volume} onChange={(v) => st.update({ volume: v })} />
                    {!rider ? <View style={{ height: 8 }} /> : null}
                    {!rider ? (
                        <>
                            <Label title={tr('Repeat every')} hint={tr('Quiet time after the bell and the voice have finished, before it rings again.')} />
                            <Chips options={REPEAT_CHOICES.map((n) => [n, `${n} sec`])} value={st.repeatSec} onChange={(v) => st.update({ repeatSec: v })} />
                        </>
                    ) : null}
                </Card>

                <SectionTitle title={tr('Voice')} />
                <Card>
                    <Label
                        title={tr('Read the order in')}
                        hint={hindi
                            ? tr('नया ऑर्डर। 2 Butter Naan… कुल 540 रुपये। Dish names stay as on your menu.')
                            : tr('New order. 2 Butter Naan… Total 540 rupees.')}
                    />
                    <Chips options={LANGUAGES} value={st.language} onChange={(v) => st.update({ language: v })} />
                </Card>

                <Card>
                    <Label title={hindi ? tr('Hindi voice') : tr('English voice')} hint={tr('Tap a name to hear it.')} />
                    {voices === null ? <View style={{ marginTop: 10 }}><LineShimmer width={200} height={16} /></View> : null}
                    {voices && !voices.length ? (
                        <Text style={{ color: muted, fontSize: 13, marginTop: 10 }}>
                            {hindi
                                ? tr('This phone has no Hindi voice, so orders are read in English. To add one: Settings → Language → Text-to-speech → Google Text-to-speech → Install voice data → हिन्दी.')
                                : tr('No English voice found on this phone. Add one: Settings → Language → Text-to-speech → Google Text-to-speech → Install voice data → English (India).')}
                        </Text>
                    ) : null}
                    <View style={{ marginTop: 4 }}>
                        {(voices || []).slice(0, 8).map(({ voice, name, sub, recommended }, i, arr) => (
                            <Option
                                key={voice.identifier}
                                selected={voice.identifier === chosenId}
                                title={name}
                                subtitle={sub}
                                badge={recommended ? <Pill label={tr('Recommended')} color={ok} icon="star" /> : null}
                                last={i === arr.length - 1}
                                onPress={() => { st.update(hindi ? { voiceIdHi: voice.identifier } : { voiceId: voice.identifier }); sampleVoice(voice, st.language); }}
                            />
                        ))}
                    </View>
                </Card>

                {!rider ? <SectionTitle title={tr('Greeting before the order')} /> : null}
                {!rider ? (
                <>
                <Card>
                    <Switcher
                        title={tr('Call me')}
                        subtitle={hindi ? '"सर", "मैडम" या आपका नाम' : tr('Say "sir", "madam" or your name')}
                        value={st.callMe}
                        onChange={(v) => st.update({ callMe: v })}
                    />
                    {st.callMe ? (
                        <View style={{ marginTop: 6 }}>
                            <Chips options={ADDRESS_CHOICES} value={st.addressAs} onChange={(v) => st.update({ addressAs: v })} />
                            {st.addressAs === 'name' ? (
                                <View style={{ marginTop: 4 }}>
                                    <Label title={tr('Name to say')} hint={hindi ? tr('उदाहरण: "Ankit" को "Ankit जी" बोला जाएगा।') : tr('For example "Ankit", said as "Ankit".')} />
                                    <TextInput
                                        value={st.ownerName}
                                        onChangeText={(v) => st.update({ ownerName: v })}
                                        placeholder={tr('Your name')}
                                        placeholderTextColor={muted}
                                        maxLength={30}
                                        autoCapitalize="words"
                                        style={{ marginTop: 8, borderWidth: 1, borderColor: border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: text, fontSize: 15 }}
                                    />
                                    {!st.ownerName.trim() ? (
                                        <Text style={{ color: error, fontSize: 12, marginTop: 6 }}>{tr('No name yet, so "sir" is said. Type your name above.')}</Text>
                                    ) : null}
                                </View>
                            ) : null}
                        </View>
                    ) : null}
                </Card>

                <Card>
                    <Label title={tr('Greeting of your faith')} hint={tr('Said once when a new order arrives, in front of the order.')} />
                    <View style={{ marginTop: 4 }}>
                        <Option selected={!st.greetFaith} title={tr('None')} onPress={() => st.update({ greetFaith: null })} last />
                    </View>
                    {FAITH_GREETINGS.map(([group, rows]) => (
                        <View key={group}>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 14, letterSpacing: 0.6 }}>{group.toUpperCase()}</Text>
                            {rows.map(([id, en, hi], i) => (
                                <Option
                                    key={id}
                                    selected={st.greetFaith === id}
                                    title={hindi ? hi : en}
                                    subtitle={hindi ? en : hi}
                                    last={i === rows.length - 1}
                                    onPress={() => { st.update({ greetFaith: id }); setTimeout(previewGreeting, 50); }}
                                />
                            ))}
                        </View>
                    ))}
                    <Button label={tr('Hear the greeting')} icon="volume-high" kind="ghost" onPress={previewGreeting} style={{ marginTop: 14 }} />
                    <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>
                        {tr('The greeting is said once, in front of the order.')}
                    </Text>
                </Card>
                </>
                ) : null}

                </View>

            </KeyboardScroll>
        </View>
    );
}
