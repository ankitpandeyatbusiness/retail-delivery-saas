// The chat of a bulk order, a service inquiry or a table booking (like WhatsApp): text, pictures and voice notes, shown live, with ticks
// (sent / delivered / read), "typing...", day headings, and a notice when the chat has closed. One screen for the customer and the owner.
// Route 'Chat', params { kind: 'bulk' | 'inquiry' | 'booking', refId, title? }.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, useAudioRecorder, RecordingPresets } from 'expo-audio';
import { useBrand, alpha } from './kit';
import { PageHeader, Sheet } from '../owners/ui';
import { PictureViewer } from './InquiryThread';
import { showToast } from '../customers/shop';
import { chatApi } from '../../api/common/chatApi';
import { onChatMessage, onChatStatus, onChatTyping } from '../../api/common/socket';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useChatStore } from '../../store/common/useChatStore';
import { pickPhoto } from '../../utils/common/photoUpload';
import { uploadChatPhoto, uploadChatVoice } from '../../utils/common/chatUpload';
import { tickColors } from '../../utils/common/chatColors';
import { tr } from '../../i18n';

const MAX_VOICE = 120;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
const dayLabel = (d) => {
    const x = new Date(d); const t = new Date();
    const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(x.getFullYear(), x.getMonth(), x.getDate())) / 86400000);
    return diff === 0 ? tr('Today') : diff === 1 ? tr('Yesterday') : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// the ticks under my message: one grey (sent), two grey (delivered), two coloured (read); colours picked so they show on the bubble
function Ticks({ status, colors }) {
    if (status === 'sending') return <Ionicons name="time-outline" size={14} color={colors.sent} />;
    if (status === 'failed') return <Ionicons name="alert-circle" size={15} color="#E53935" />;
    if (status === 'sent') return <Ionicons name="checkmark" size={15} color={colors.sent} />;
    return <Ionicons name="checkmark-done" size={16} color={status === 'read' ? colors.read : colors.delivered} />;
}

// a voice note: a play button, a bar and the length
function VoiceBubble({ voice, ink, track }) {
    const [playing, setPlaying] = useState(false);
    const [pos, setPos] = useState(0);
    const player = useRef(null);
    const timer = useRef(null);
    const stop = () => { clearInterval(timer.current); setPlaying(false); };
    useEffect(() => () => { clearInterval(timer.current); try { player.current?.remove?.(); } catch (e) { /* gone */ } }, []);
    const toggle = async () => {
        try {
            if (!player.current) { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); player.current = createAudioPlayer(voice.url); }
            const p = player.current;
            if (playing) { p.pause(); stop(); return; }
            if (p.duration && p.currentTime >= p.duration - 0.2) p.seekTo(0);
            p.play(); setPlaying(true);
            timer.current = setInterval(() => {
                setPos(p.currentTime || 0);
                if (!p.playing && (p.currentTime || 0) >= (p.duration || voice.sec) - 0.3) { stop(); setPos(0); }
            }, 250);
        } catch (e) { showToast(tr('Could not play the voice note')); stop(); }
    };
    const total = voice.sec || 1;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 190 }}>
            <Pressable onPress={toggle} hitSlop={8} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: alpha(ink, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={playing ? 'pause' : 'play'} size={20} color={ink} />
            </Pressable>
            <View style={{ flex: 1, marginHorizontal: 10 }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: alpha(ink, 0.25) }}>
                    <View style={{ height: 4, borderRadius: 2, width: `${Math.min(100, (pos / total) * 100)}%`, backgroundColor: track }} />
                </View>
                <Text style={{ color: ink, opacity: 0.8, fontSize: 11.5, marginTop: 4 }}>{mmss(playing ? pos : total)}</Text>
            </View>
            <Ionicons name="mic" size={16} color={ink} style={{ opacity: 0.7 }} />
        </View>
    );
}

function Bubble({ m, colors, onPicture, onRetry }) {
    const { text, primary, onPrimary, surface, border, muted } = useBrand();
    const mine = m.mine;
    const bg = mine ? primary : surface;
    const ink = mine ? onPrimary : text;
    return (
        <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 6 }}>
            <Pressable onPress={m.status === 'failed' ? onRetry : undefined} style={{ backgroundColor: bg, borderWidth: mine ? 0 : 1, borderColor: border, borderRadius: 16, borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4, paddingHorizontal: 11, paddingVertical: 8 }}>
                {(m.images || []).length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: m.text ? 6 : 0 }}>
                        {m.images.map((u) => (
                            <Pressable key={u} onPress={() => onPicture(u)} style={{ marginRight: 4, marginBottom: 4 }}>
                                <Image source={{ uri: u }} style={{ width: m.images.length > 1 ? 120 : 210, height: m.images.length > 1 ? 120 : 210, borderRadius: 10 }} contentFit="cover" transition={150} />
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                {m.voice ? <VoiceBubble voice={m.voice} ink={ink} track={mine ? colors.read : primary} /> : null}
                {m.text ? <Text style={{ color: ink, fontSize: 15, lineHeight: 20 }}>{m.text}</Text> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 }}>
                    <Text style={{ color: ink, opacity: 0.7, fontSize: 10.5, marginRight: mine ? 4 : 0 }}>{clock(m.at)}</Text>
                    {mine ? <Ticks status={m.status} colors={colors} /> : null}
                </View>
            </Pressable>
            {m.status === 'failed' ? <Text style={{ color: '#E53935', fontSize: 11.5, fontWeight: '700', alignSelf: 'flex-end', marginTop: 2 }}>{tr('Not sent. Tap to try again.')}</Text> : null}
        </View>
    );
}

export default function ChatScreen() {
    const { kind, refId, title: given } = useRoute().params || {};
    const role = useAuthStore((s) => s.user?.role);
    const insets = useSafeAreaInsets();
    const { background, text, muted, primary, onPrimary, surface, border, error } = useBrand();
    const colors = useMemo(() => tickColors(primary), [primary]);
    const [items, setItems] = useState(null);
    const [meta, setMeta] = useState({ closed: false, closesAt: null, title: given || '' });
    const [input, setInput] = useState('');
    const [typing, setTyping] = useState(false);
    const [pic, setPic] = useState('');
    const [attach, setAttach] = useState(false);
    const [recording, setRecording] = useState(false);
    const [secs, setSecs] = useState(0);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const typingTimer = useRef(null);
    const lastTyping = useRef(0);
    const recTimer = useRef(null);
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const key = `${kind}:${refId}`;

    const merge = useCallback((incoming) => setItems((all) => {
        const have = new Map((all || []).map((x) => [x.id, x]));
        incoming.forEach((m) => { have.set(m.id, { ...have.get(m.id), ...m }); });
        return [...have.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
    }), []);

    const load = useCallback(async () => {
        try {
            const r = await chatApi.list(kind, refId, true);
            setItems(r.items); setMeta({ closed: r.closed, closesAt: r.closesAt, title: r.title || given || '' }); setErr('');
            useChatStore.getState().clear(kind, refId);
        } catch (e) { setErr(e?.response?.data?.error || tr('Could not open this chat')); setItems((x) => x || []); }
    }, [kind, refId, given]);

    useEffect(() => {
        useChatStore.getState().setOpen(key);
        load();
        const a = onChatMessage((p) => {
            if (p.kind !== kind || String(p.refId) !== String(refId)) return;
            merge([p.message]);
            if (!p.echo) { setTyping(false); chatApi.read(kind, refId).catch(() => { }); }
        });
        const b = onChatStatus((p) => {
            if (p.kind !== kind || String(p.refId) !== String(refId)) return;
            const ids = new Set(p.ids);
            setItems((all) => (all || []).map((m) => (ids.has(m.id) && m.mine ? { ...m, status: p.status === 'read' ? 'read' : (m.status === 'read' ? 'read' : 'delivered') } : m)));
        });
        const c = onChatTyping((p) => {
            if (p.kind !== kind || String(p.refId) !== String(refId)) return;
            setTyping(true); clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => setTyping(false), 4000);
        });
        return () => { a(); b(); c(); clearTimeout(typingTimer.current); clearInterval(recTimer.current); useChatStore.getState().setOpen(null); };
    }, [kind, refId, key, load, merge]);

    const onType = (v) => {
        setInput(v);
        const now = Date.now();
        if (v && now - lastTyping.current > 2500) { lastTyping.current = now; chatApi.typing(kind, refId).catch(() => { }); }
    };

    // send: shown at once with a clock, then the server's answer replaces it
    const deliver = useCallback(async (payload, local) => {
        merge([local]);
        try {
            const m = await chatApi.send(kind, refId, { ...payload, clientId: local.clientId });
            setItems((all) => (all || []).filter((x) => x.id !== local.id));
            merge([m]);
        } catch (e) {
            const msg = e?.response?.data?.error;
            if (e?.response?.status === 409 && msg) { setMeta((x) => ({ ...x, closed: true })); setItems((all) => (all || []).filter((x) => x.id !== local.id)); showToast(tr(msg)); return; }
            merge([{ ...local, status: 'failed', payload }]);
        }
    }, [kind, refId, merge]);

    const sendText = () => {
        const t = input.trim();
        if (!t) return;
        setInput('');
        const clientId = newId();
        deliver({ text: t }, { id: `local-${clientId}`, clientId, mine: true, text: t, images: [], voice: null, at: new Date().toISOString(), status: 'sending' });
    };
    const retry = (m) => {
        if (!m.payload) return;
        deliver(m.payload, { ...m, status: 'sending' });
    };

    const sendPhoto = async (source) => {
        setAttach(false);
        try {
            const p = await pickPhoto(source);
            if (!p) return;
            setBusy(true);
            const clientId = newId();
            const local = { id: `local-${clientId}`, clientId, mine: true, text: '', images: [p.uri], voice: null, at: new Date().toISOString(), status: 'sending' };
            merge([local]);
            let url;
            try { url = await uploadChatPhoto({ role, uri: p.uri, mimeType: p.mimeType }); } catch (e) { setItems((all) => (all || []).filter((x) => x.id !== local.id)); throw e; }
            await deliver({ images: [url] }, { ...local, images: [url] });
        } catch (e) { showToast(e?.safe ? e.message : tr('Could not send the photo')); } finally { setBusy(false); }
    };

    const startRecording = async () => {
        try {
            const perm = await requestRecordingPermissionsAsync();
            if (!perm.granted) { showToast(tr('Allow the microphone in settings to send a voice note')); return; }
            await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
            await recorder.prepareToRecordAsync();
            recorder.record();
            setSecs(0); setRecording(true);
            recTimer.current = setInterval(() => {
                const s = Math.floor(recorder.currentTime || 0);
                setSecs(s);
                if (s >= MAX_VOICE) finishRecording(true);
            }, 300);
        } catch (e) { showToast(tr('Could not start recording')); setRecording(false); }
    };
    const finishRecording = async (send) => {
        clearInterval(recTimer.current);
        setRecording(false);
        try {
            await recorder.stop();
            const uri = recorder.uri;
            const sec = Math.max(1, Math.round(recorder.currentTime || secs));
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });
            if (!send || !uri || sec < 1) return;
            setBusy(true);
            const clientId = newId();
            const local = { id: `local-${clientId}`, clientId, mine: true, text: '', images: [], voice: { url: uri, sec }, at: new Date().toISOString(), status: 'sending' };
            merge([local]);
            let url;
            try { url = await uploadChatVoice({ role, uri }); } catch (e) { setItems((all) => (all || []).filter((x) => x.id !== local.id)); throw e; }
            await deliver({ voice: { url, sec } }, { ...local, voice: { url, sec } });
        } catch (e) { showToast(e?.safe ? e.message : tr('Could not send the voice note')); } finally { setBusy(false); }
    };

    // newest at the bottom: the list is upside down, so the data goes newest first, with a heading before each day's oldest message
    const rows = useMemo(() => {
        const out = [];
        const list = items || [];
        list.forEach((m, i) => {
            if (i === 0 || dayKey(list[i - 1].at) !== dayKey(m.at)) out.push({ day: m.at, id: `day-${dayKey(m.at)}` });
            out.push(m);
        });
        return out.reverse();
    }, [items]);

    const closes = meta.closesAt ? new Date(meta.closesAt) : null;
    const daysLeft = closes && !meta.closed ? Math.max(0, Math.ceil((closes - Date.now()) / 86400000)) : null;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={meta.title || tr('Chat')} />
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
                {typing ? <Text style={{ color: primary, fontWeight: '800', fontSize: 12.5 }}>{tr('typing…')}</Text>
                    : daysLeft !== null && daysLeft <= 2 ? <Text style={{ color: muted, fontSize: 12 }}>{tr('This chat closes in {n} day(s)', { n: Math.max(1, daysLeft) })}</Text> : null}
            </View>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                {items === null ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={primary} /></View> : (
                    <FlatList
                        inverted data={rows} keyExtractor={(r) => r.id} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                        ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }], alignItems: 'center', marginTop: 40 }}><Ionicons name="chatbubbles-outline" size={42} color={muted} /><Text style={{ color: muted, marginTop: 8, textAlign: 'center' }}>{err || tr('No messages yet. Say hello!')}</Text></View>}
                        renderItem={({ item }) => item.day
                            ? <View style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: alpha(muted, 0.16) }}><Text style={{ color: muted, fontWeight: '800', fontSize: 11.5 }}>{dayLabel(item.day)}</Text></View>
                            : <Bubble m={item} colors={colors} onPicture={setPic} onRetry={() => retry(item)} />}
                    />
                )}
                {meta.closed ? (
                    <View style={{ paddingHorizontal: 16, paddingVertical: 14, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderTopColor: border, backgroundColor: surface }}>
                        <Text style={{ color: muted, textAlign: 'center', fontWeight: '700' }}>{tr('This chat is closed.')}</Text>
                    </View>
                ) : recording ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), borderTopWidth: 1, borderTopColor: border, backgroundColor: surface }}>
                        <Pressable onPress={() => finishRecording(false)} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="trash-outline" size={24} color={error} /></Pressable>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: error, marginHorizontal: 8 }} />
                        <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 16 }}>{mmss(secs)}  <Text style={{ color: muted, fontWeight: '600', fontSize: 12.5 }}>{tr('Recording…')}</Text></Text>
                        <Pressable onPress={() => finishRecording(true)} hitSlop={8} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="send" size={20} color={onPrimary} /></Pressable>
                    </View>
                ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), borderTopWidth: 1, borderTopColor: border, backgroundColor: surface }}>
                        <Pressable onPress={() => setAttach(true)} hitSlop={6} disabled={busy} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1 }}><Ionicons name="attach" size={26} color={muted} /></Pressable>
                        <TextInput
                            value={input} onChangeText={onType} placeholder={tr('Type a message')} placeholderTextColor={muted} multiline maxLength={1000}
                            style={{ flex: 1, maxHeight: 120, minHeight: 44, color: text, fontSize: 15.5, borderWidth: 1, borderColor: border, borderRadius: 22, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, backgroundColor: background }}
                        />
                        {input.trim() ? (
                            <Pressable onPress={sendText} hitSlop={6} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}><Ionicons name="send" size={20} color={onPrimary} /></Pressable>
                        ) : (
                            <Pressable onPress={startRecording} hitSlop={6} disabled={busy} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginLeft: 6, opacity: busy ? 0.5 : 1 }}><Ionicons name="mic" size={22} color={onPrimary} /></Pressable>
                        )}
                    </View>
                )}
            </KeyboardAvoidingView>

            <Sheet visible={attach} onClose={() => setAttach(false)} title={tr('Send a photo')}>
                <Pressable onPress={() => sendPhoto('camera')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="camera-outline" size={24} color={primary} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('Take a photo')}</Text></Pressable>
                <Pressable onPress={() => sendPhoto('gallery')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="image-outline" size={24} color={primary} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('Choose from gallery')}</Text></Pressable>
            </Sheet>
            <PictureViewer uri={pic} onClose={() => setPic('')} />
        </View>
    );
}
