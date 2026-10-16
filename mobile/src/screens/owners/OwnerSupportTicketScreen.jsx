// One help request as a conversation. The owner's messages sit on the right, the platform team's on the left. He can
// reply (with pictures), mark it solved, rate the help, and reopen it for 7 days by replying. Opened with params { id }.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform, Linking, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import PictureStrip from '../../components/owners/PictureStrip';
import { fetchSupportTicket, replySupport, resolveSupport, rateSupport, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { SUPPORT_STATUS, SUPPORT_TOPICS } from '../../utils/owners/supportRules';
import { dayTime } from '../../utils/owners/orderFlow';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';

function Bubble({ m }) {
    const { primary, onPrimary, surface, border, text, muted } = useBrand();
    const mine = m.from === 'owner';
    return (
        <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 12, paddingHorizontal: 16 }}>
            <View style={{ maxWidth: '86%', borderRadius: 18, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, padding: 12, backgroundColor: mine ? primary : surface, borderWidth: mine ? 0 : 1, borderColor: border }}>
                {!mine ? <Text style={{ color: primary, fontWeight: '900', fontSize: 12, marginBottom: 3 }}>{m.by || 'Support'}</Text> : null}
                <Text style={{ color: mine ? onPrimary : text, lineHeight: 21 }}>{m.text}</Text>
                {m.photos?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                        {m.photos.map((u) => (
                            <Pressable key={u} onPress={() => Linking.openURL(u).catch(() => { })} style={{ marginRight: 6, marginBottom: 6 }}>
                                <Image source={{ uri: u }} style={{ width: 96, height: 96, borderRadius: 10 }} contentFit="cover" />
                            </Pressable>
                        ))}
                    </View>
                ) : null}
            </View>
            <Text style={{ color: muted, fontSize: 11, marginTop: 3 }}>{dayTime(m.at)}</Text>
        </View>
    );
}

function Rate({ onRate }) {
    const { text, muted, primary } = useBrand();
    const [stars, setStars] = useState(0);
    const [busy, setBusy] = useState(false);
    return (
        <Card>
            <Text style={{ color: text, fontWeight: '900' }}>How was our help?</Text>
            <View style={{ flexDirection: 'row', marginVertical: 10 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setStars(n)} hitSlop={6} style={{ marginRight: 8 }}>
                        <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={32} color={n <= stars ? '#F59E0B' : muted} />
                    </Pressable>
                ))}
            </View>
            <Button label="Send rating" disabled={!stars} busy={busy} onPress={async () => { setBusy(true); try { await onRate(stars); } finally { setBusy(false); } }} />
        </Card>
    );
}

export default function OwnerSupportTicketScreen({ route }) {
    const { id } = route.params;
    const insets = useSafeAreaInsets();
    const { background, surface, border, text, muted, primary, onPrimary, error } = useBrand();
    const [t, setT] = useState(null);
    const [err, setErr] = useState('');
    const [msg, setMsg] = useState('');
    const [photos, setPhotos] = useState([]);
    const [sending, setSending] = useState(false);
    const scroll = useRef(null);
    const refId = useMemo(() => `s${Date.now().toString(36)}`, []);

    const load = useCallback(async () => {
        try {
            const x = await fetchSupportTicket(id);
            setT(x); setErr('');
            useOwnerStore.getState().refresh();
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this request.')); }
    }, [id]);
    useFocusEffect(useCallback(() => {
        load();
        const timer = setInterval(load, 15000);   // a reply from the team shows up by itself
        return () => clearInterval(timer);
    }, [load]));
    useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 60); }, [t?.messages?.length]);

    if (!t) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title="Request" />{err ? <Empty icon="cloud-offline-outline" title="Could not open" hint={err} /> : <ListShimmer count={3} />}</View>;

    const st = SUPPORT_STATUS[t.status] || SUPPORT_STATUS.open;
    const resolved = t.status === 'resolved';
    const send = async () => {
        if (!msg.trim() || sending) return;
        setSending(true);
        try {
            const x = await replySupport(id, { message: msg.trim(), photos });
            setT(x); setMsg(''); setPhotos([]);
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSending(false); }
    };
    const solved = async () => {
        const yes = await ask({ title: 'Mark as solved?', message: 'You can still reply within 7 days if it comes back.', confirmText: 'Mark solved' });
        if (!yes) return;
        try { setT(await resolveSupport(id)); } catch (e) { showToast(apiError(e)); }
    };
    const rate = async (stars) => {
        try { setT(await rateSupport(id, { stars })); showToast('Thank you!'); } catch (e) { showToast(apiError(e)); }
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={`Request #${t.number}`} right={!resolved ? <Pressable onPress={solved} hitSlop={10}><Text style={{ color: primary, fontWeight: '800' }}>Mark solved</Text></Pressable> : null} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView ref={scroll} contentContainerStyle={{ paddingTop: 6, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
                    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{t.subject}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                            <Pill label={st.label} color={st.color(primary, error)} />
                            <Text style={{ color: muted, fontSize: 12, marginLeft: 8 }}>{SUPPORT_TOPICS.find((x) => x[0] === t.category)?.[1] || 'Other'}</Text>
                        </View>
                    </View>
                    {t.messages.map((m) => <Bubble key={m.id} m={m} />)}
                    {resolved && !t.rating ? <Rate onRate={rate} /> : null}
                    {resolved && t.rating ? <Text style={{ color: muted, textAlign: 'center', marginVertical: 8 }}>You rated this {t.rating.stars} of 5. Thank you!</Text> : null}
                </ScrollView>

                {resolved && !t.canReopen ? (
                    <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 12) + 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border, backgroundColor: background }}>
                        <Text style={{ color: muted, textAlign: 'center' }}>This request was solved more than 7 days ago. Please start a new request.</Text>
                    </View>
                ) : (
                    <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border, backgroundColor: background }}>
                        {resolved ? <Text style={{ color: muted, fontSize: 12, marginBottom: 6 }}>Solved. Writing here opens it again.</Text> : null}
                        <PictureStrip value={photos} onChange={setPhotos} refId={refId} size={52} />
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                            <TextInput
                                value={msg} onChangeText={setMsg} placeholder="Write a reply" placeholderTextColor={muted} multiline maxLength={2000}
                                style={{ flex: 1, minHeight: 46, maxHeight: 120, borderWidth: 1, borderColor: border, borderRadius: 23, paddingHorizontal: 16, paddingVertical: 11, color: text, backgroundColor: surface, fontSize: 15 }}
                            />
                            <Pressable onPress={send} disabled={!msg.trim() || sending} style={{ width: 46, height: 46, borderRadius: 23, marginLeft: 8, backgroundColor: msg.trim() ? primary : alpha(muted, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="send" size={19} color={onPrimary} />
                            </Pressable>
                        </View>
                    </View>
                )}
            </KeyboardAvoidingView>
        </View>
    );
}
