// The chat of a bulk order, a service inquiry or a table booking (like WhatsApp): text, pictures and voice notes, shown live, with ticks
// (sent / delivered / read), "typing...", day headings, and a notice when the chat has closed. One screen for the customer and the owner.
// Route 'Chat', params { kind: 'bulk' | 'inquiry' | 'booking', refId, title? }.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, PanResponder, Platform } from 'react-native';
import Animated from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useIsDesktopWeb } from '../../utils/common/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createAudioPlayer, setAudioModeAsync, requestRecordingPermissionsAsync, useAudioRecorder, RecordingPresets } from 'expo-audio';
import { useBrand, alpha } from './kit';
import { PageHeader, Sheet } from '../owners/ui';
import { PictureViewer } from './InquiryThread';
import { showToast } from '../customers/shop';
import { chatApi } from '../../api/common/chatApi';
import { onChatMessage, onChatStatus, onChatTyping, onChatDeleted } from '../../api/common/socket';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useChatStore } from '../../store/common/useChatStore';
import { pickPhoto } from '../../utils/common/photoUpload';
import { uploadChatPhoto, uploadChatVoice } from '../../utils/common/chatUpload';
import { tickColors } from '../../utils/common/chatColors';
import { tr } from '../../i18n';
import { ease } from '../../utils/common/ease';
import { playSfx } from '../../utils/common/sfx';
import { saveMedia, notify } from '../../utils/common/saveMedia';
import { ask } from './dialog';
import { inquiries } from '../../api/owners/shopApi';
import useKeyboardLift from '../../hooks/common/useKeyboardLift';
import ChatBackdrop from './ChatBackdrop';
import ChatShimmer from './ChatShimmer';
import TypingBubble from './TypingBubble';

const WEB = Platform.OS === 'web';
const MAX_VOICE = 120;
const DELETE_ALL_MS = 2 * 24 * 3600 * 1000;   // "delete for everyone": only your own message, for 2 days after you sent it (the server enforces it too)
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

// a voice note: a play button, a bar you can drag (or tap) to jump to any point, and the time. Every voice note has the same width, so they line up.
function VoiceBubble({ voice, ink, track, onLongPress }) {
    const [playing, setPlaying] = useState(false);
    const [pos, setPos] = useState(0);         // seconds played
    const [drag, setDrag] = useState(null);    // 0 to 1 while a finger is on the bar
    const player = useRef(null);
    const timer = useRef(null);
    const width = useRef(1);
    const startX = useRef(0);
    const live = useRef({});
    const target = useRef(0);       // where the last jump went (seconds) ...
    const holdUntil = useRef(0);    // ... and until when a stale reading of the player must not pull the bar back there
    const total = voice.sec || 1;
    const lengthNow = () => { const d = player.current?.duration; return d && Number.isFinite(d) && d > 0 ? d : total; };
    const stop = () => { clearInterval(timer.current); setPlaying(false); };
    useEffect(() => () => { clearInterval(timer.current); try { player.current?.remove?.(); } catch (e) { /* gone */ } }, []);
    const ensure = async () => {
        if (!player.current) { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); player.current = createAudioPlayer(voice.url); }
        return player.current;
    };
    const tick = (p) => {
        clearInterval(timer.current);
        timer.current = setInterval(() => {
            const t = p.currentTime || 0;
            if (Date.now() < holdUntil.current && Math.abs(t - target.current) > 1) return;   // the player has not caught up with the jump yet
            setPos(t);
            if (!p.playing && t >= lengthNow() - 0.3) { stop(); setPos(0); }
        }, 100);
    };
    const toggle = async () => {
        try {
            const p = await ensure();
            if (playing) { p.pause(); stop(); return; }
            if (p.duration && p.currentTime >= p.duration - 0.2) await p.seekTo(0);
            p.play(); setPlaying(true); tick(p);
        } catch (e) { showToast(tr('Could not play the voice note')); stop(); }
    };
    // jump to a point (0 to 1): works before play, while playing and while paused
    const seek = async (frac) => {
        const t = Math.min(Math.max(frac, 0), 1) * lengthNow();
        target.current = t; holdUntil.current = Date.now() + 800;
        setPos(t);   // the bar is already there before the audio has finished jumping: no snap back, no jerk
        try {
            const p = await ensure();
            await p.seekTo(t);
            if (playing) tick(p);
        } catch (e) { /* the bar simply stays where it is */ }
    };
    live.current = { seek };
    const fracAt = (x) => Math.min(Math.max(x / (width.current || 1), 0), 1);
    const pan = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => { startX.current = e.nativeEvent.locationX; setDrag(fracAt(startX.current)); },
        onPanResponderMove: (e, g) => setDrag(fracAt(startX.current + g.dx)),
        onPanResponderRelease: (e, g) => { const f = fracAt(startX.current + g.dx); live.current.seek(f); setDrag(null); },
        onPanResponderTerminate: () => setDrag(null),
    }), []);   // eslint-disable-line react-hooks/exhaustive-deps
    const len = lengthNow();
    const frac = drag !== null ? drag : Math.min(1, pos / len);
    const shownSec = drag !== null ? drag * len : (playing || pos > 0 ? pos : total);
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', width: 232 }}>
            <Pressable onPress={toggle} onLongPress={onLongPress} delayLongPress={350} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(ink, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={playing ? 'pause' : 'play'} size={20} color={ink} style={{ marginLeft: playing ? 0 : 2 }} />
            </Pressable>
            <View style={{ flex: 1, marginLeft: 10 }}>
                <View {...pan.panHandlers} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }} style={{ height: 30, justifyContent: 'center' }}>
                    <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: alpha(ink, 0.25) }}>
                        <View style={{ height: 4, borderRadius: 2, width: `${frac * 100}%`, backgroundColor: track }} />
                    </View>
                    <View pointerEvents="none" style={{ position: 'absolute', left: `${frac * 100}%`, marginLeft: -7, width: 14, height: 14, borderRadius: 7, backgroundColor: track }} />
                </View>
                <Text style={{ color: ink, opacity: 0.8, fontSize: 11.5 }}>{mmss(shownSec)}</Text>
            </View>
        </View>
    );
}

function Bubble({ m, colors, onPicture, onRetry, onActions }) {
    const { text, primary, onPrimary, surface, border, muted } = useBrand();
    const desk = useIsDesktopWeb();   // the desktop website: narrower bubbles with a soft shadow (false in the phone app)
    const mine = m.mine;
    const bg = mine ? primary : surface;
    const ink = mine ? onPrimary : text;
    const canAct = !String(m.id).startsWith('legacy-') && m.status !== 'sending';   // an old inquiry word or a message still being sent has no menu
    if (m.deleted) {
        return (
            <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 6 }}>
                <Pressable onLongPress={canAct ? () => onActions(m) : undefined} delayLongPress={350} style={{ backgroundColor: mine ? alpha(primary, 0.16) : alpha(surface, 0.85), borderWidth: 1, borderColor: mine ? alpha(primary, 0.3) : border, borderRadius: 16, borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4, paddingHorizontal: 11, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="ban-outline" size={15} color={muted} />
                        <Text style={{ color: muted, fontSize: 14, fontStyle: 'italic', marginLeft: 6 }}>{mine ? tr('You deleted this message') : tr('This message was deleted')}</Text>
                    </View>
                    <Text style={{ color: muted, fontSize: 10.5, alignSelf: 'flex-end', marginTop: 3 }}>{clock(m.at)}</Text>
                </Pressable>
            </View>
        );
    }
    return (
        <View style={[{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: desk ? '66%' : '82%', marginBottom: desk ? 8 : 6 }, desk && { filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.22))' }]}>
            <Pressable onPress={m.status === 'failed' ? onRetry : undefined} onLongPress={canAct ? () => onActions(m) : undefined} delayLongPress={350} style={{ backgroundColor: bg, borderWidth: mine ? 0 : 1, borderColor: border, borderRadius: 16, borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4, paddingHorizontal: 11, paddingVertical: 8 }}>
                {(m.images || []).length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: m.text ? 6 : 0 }}>
                        {m.images.map((u) => (
                            <Pressable key={u} onPress={() => onPicture(u)} onLongPress={() => onActions(m, u)} delayLongPress={350} style={{ marginRight: 4, marginBottom: 4 }}>
                                <Image source={{ uri: u }} style={{ width: m.images.length > 1 ? 120 : 210, height: m.images.length > 1 ? 120 : 210, borderRadius: 10 }} contentFit="cover" transition={150} />
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                {m.voice ? <VoiceBubble voice={m.voice} ink={ink} track={mine ? colors.read : primary} onLongPress={() => onActions(m)} /> : null}
                {m.text ? <Text style={{ color: ink, fontSize: desk ? 15.5 : 15, lineHeight: desk ? 22 : 20 }}>{m.text}</Text> : null}
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
    const nav = useNavigation();
    const desk = useIsDesktopWeb();   // the desktop website: the chat is a rounded panel with its own header, like WhatsApp Web (false in the phone app)
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
    const [menu, setMenu] = useState(false);          // the three dots at the top
    const [actions, setActions] = useState(null);     // { m, uri? } the message whose menu is open (save, delete for me, delete for everyone)
    const [recording, setRecording] = useState(false);
    const [secs, setSecs] = useState(0);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const typingTimer = useRef(null);
    const lastTyping = useRef(0);
    const recTimer = useRef(null);
    const recStart = useRef(0);   // when the recording began (the website counts the seconds itself)
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
    const key = `${kind}:${refId}`;

    const itemsRef = useRef(null);
    useEffect(() => { itemsRef.current = items; }, [items]);
    const typingSeen = useRef(false);
    useEffect(() => { if (typingSeen.current) ease(); typingSeen.current = true; }, [typing]);   // the typing bubble slides in and out, not jumps
    const lift = useKeyboardLift();   // the input rides on the keyboard

    const merge = useCallback((incoming) => {
        // a really new bubble: the list glides to make room (nothing animates while the chat is first loading, or when a copy only replaces another)
        const now = itemsRef.current;
        if (now && incoming.some((m) => !now.some((x) => x.id === m.id || (m.clientId && x.clientId === m.clientId)))) ease();
        setItems((all) => {
            const have = new Map((all || []).map((x) => [x.id, x]));
            incoming.forEach((m0) => {
                let m = m0;
                // the server's copy of a message I just sent takes the place of my "sending" copy (matched by clientId; by the same words when an older server sends none),
                // so there is never a twin bubble. It keeps the clientId, so the row keeps its key and does not flash.
                if (m.mine && !String(m.id).startsWith('local-')) {
                    for (const [k, x] of have) {
                        if (String(k).startsWith('local-') && (m.clientId ? x.clientId === m.clientId : (!!m.text && x.text === m.text && x.status === 'sending'))) { have.delete(k); m = { ...m, clientId: x.clientId }; break; }
                    }
                }
                have.set(m.id, { ...have.get(m.id), ...m });
            });
            return [...have.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
        });
    }, []);

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
            const known = (itemsRef.current || []).some((x) => x.id === p.message.id);
            merge([p.message]);
            if (!p.echo) { if (!known) playSfx('chatReceived'); setTyping(false); chatApi.read(kind, refId).catch(() => { }); }   // his message arrived while the chat is open: the soft ping
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
        const dd = onChatDeleted((p) => {
            if (p.kind !== kind || String(p.refId) !== String(refId)) return;
            const ids = new Set(p.ids);
            ease();
            if (p.scope === 'all') setItems((all) => (all || []).map((m) => (ids.has(m.id) ? { ...m, text: '', images: [], voice: null, deleted: true } : m)));   // only a note stays
            else setItems((all) => (all || []).filter((m) => !ids.has(m.id)));                                                                                      // deleted for me on my other phone
        });
        return () => { a(); b(); c(); dd(); clearTimeout(typingTimer.current); clearInterval(recTimer.current); useChatStore.getState().setOpen(null); };
    }, [kind, refId, key, load, merge]);

    // only the shop owner ends (or opens again) an inquiry conversation; bulk order and booking chats close by themselves with the order or the booking
    const canManage = role === 'admin' && kind === 'inquiry';
    const setEnded = async (ended) => {
        setMenu(false);
        if (ended && !(await ask({ title: tr('End this conversation?'), message: tr('The customer can read it, but cannot write. You can open it again any time.'), confirmText: tr('End it'), cancelText: tr('Keep it open'), destructive: true }))) return;
        try {
            await inquiries.update(refId, { status: ended ? 'closed' : 'replied' });
            await load();
            showToast(ended ? tr('The conversation has ended') : tr('The conversation is open again'));
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not do that. Try again.')); }
    };
    // save (or pass on) a picture or a voice note: the phone's own save and share sheet opens
    const saving = useRef(false);
    const saveIt = async (kind2, url) => {
        if (saving.current) return;   // a second tap while the first is still working does nothing
        saving.current = true;
        try { await saveMedia(url, kind2); } catch (e) { console.warn('[chat save]', e?.message); notify(e?.safe ? e.message : tr('Could not save it')); } finally { saving.current = false; }
    };

    const isLocal = (m) => String(m.id).startsWith('local-');
    const canDeleteAll = (m) => m.mine && !m.deleted && !isLocal(m) && !meta.closed && Date.now() - new Date(m.at).getTime() < DELETE_ALL_MS;
    const putBack = (m) => setItems((all) => [...(all || []).filter((x) => x.id !== m.id), m].sort((x, y) => new Date(x.at) - new Date(y.at)));
    // scope 'me': it disappears from my chat only. scope 'all': it becomes "This message was deleted" for both of us (your own message, while the chat is open, within 2 days)
    const deleteMessage = async (m, scope) => {
        setActions(null);
        if (isLocal(m)) { ease(); setItems((all) => (all || []).filter((x) => x.id !== m.id)); return; }   // a message that never reached the server (it failed): just take it off the screen
        const yes = await ask(scope === 'all'
            ? { title: tr('Delete this message for everyone?'), message: tr('It is removed for both of you. A note that it was deleted stays in the chat.'), confirmText: tr('Delete for everyone'), cancelText: tr('Cancel'), destructive: true }
            : { title: tr('Delete this message for you?'), message: tr('The other person will still see it.'), confirmText: tr('Delete for me'), cancelText: tr('Cancel'), destructive: true });
        if (!yes) return;
        ease();
        if (scope === 'all') setItems((all) => (all || []).map((x) => (x.id === m.id ? { ...x, text: '', images: [], voice: null, deleted: true } : x)));
        else setItems((all) => (all || []).filter((x) => x.id !== m.id));
        try { await chatApi.remove(kind, refId, m.id, scope); } catch (e) {
            ease(); putBack(m);   // it did not work: the message comes back
            showToast(e?.response?.data?.error || tr('Could not delete it. Try again.'));
        }
    };

    const onType = (v) => {
        setInput(v);
        const now = Date.now();
        if (v && now - lastTyping.current > 2500) { lastTyping.current = now; chatApi.typing(kind, refId).catch(() => { }); }
    };

    // send: shown at once with a clock, then the server's answer replaces it
    const deliver = useCallback(async (payload, local) => {
        playSfx('chatSent');   // the soft pop
        merge([local]);
        try {
            const m = await chatApi.send(kind, refId, { ...payload, clientId: local.clientId });
            merge([{ ...m, clientId: local.clientId }]);
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
            recStart.current = Date.now();
            recTimer.current = setInterval(() => {
                const s = WEB ? Math.floor((Date.now() - recStart.current) / 1000) : Math.floor(recorder.currentTime || 0);
                setSecs(s);
                if (s >= MAX_VOICE) finishRecording(true);
            }, 300);
        } catch (e) { console.warn('[chat record]', e?.message); showToast(tr('Could not start recording') + (WEB && e?.message ? ` (${e.message})` : '')); setRecording(false); }
    };
    const finishRecording = async (send) => {
        clearInterval(recTimer.current);
        setRecording(false);
        try {
            await recorder.stop();
            const uri = recorder.uri;
            const sec = Math.max(1, WEB ? Math.round((Date.now() - recStart.current) / 1000) : Math.round(recorder.currentTime || secs));
            await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => { });
            if (!send || !uri || sec < 1) return;
            setBusy(true);
            const clientId = newId();
            const local = { id: `local-${clientId}`, clientId, mine: true, text: '', images: [], voice: { url: uri, sec }, at: new Date().toISOString(), status: 'sending' };
            merge([local]);
            let url;
            try { url = await uploadChatVoice({ role, uri }); } catch (e) { setItems((all) => (all || []).filter((x) => x.id !== local.id)); throw e; }
            await deliver({ voice: { url, sec } }, { ...local, voice: { url, sec } });
        } catch (e) { console.warn('[chat voice]', e?.message); showToast(e?.safe ? e.message : tr('Could not send the voice note')); } finally { setBusy(false); }
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
            {desk ? null : (
                <>
            <PageHeader title={meta.title || tr('Chat')} right={canManage ? <Pressable onPress={() => setMenu(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel={tr('More')}><Ionicons name="ellipsis-vertical" size={22} color={text} /></Pressable> : null} />
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
                {typing ? <Text style={{ color: primary, fontWeight: '800', fontSize: 12.5 }}>{tr('typing…')}</Text>
                    : daysLeft !== null && daysLeft <= 2 ? <Text style={{ color: muted, fontSize: 12 }}>{tr('This chat closes in {n} day(s)', { n: Math.max(1, daysLeft) })}</Text> : null}
            </View>
                </>
            )}
            <Animated.View style={[{ flex: 1 }, desk && { margin: 20, marginTop: 24, borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: border, boxShadow: '0 20px 56px rgba(0,0,0,0.28)' }, lift]}>
                {desk ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13, backgroundColor: surface, borderBottomWidth: 1, borderBottomColor: border }}>
                        <Pressable onPress={() => (nav.canGoBack() ? nav.goBack() : nav.navigate('MainTabs'))} accessibilityRole="button" accessibilityLabel={tr('Back')} style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: hovered ? border : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '150ms' })}>
                            <Ionicons name="arrow-back" size={22} color={text} />
                        </Pressable>
                        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                            <Text style={{ color: onPrimary, fontSize: 19, fontWeight: '900' }}>{String(meta.title || 'C').trim().slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} style={{ color: text, fontSize: 17, fontWeight: '800' }}>{meta.title || tr('Chat')}</Text>
                            <Text numberOfLines={1} style={{ color: typing ? primary : muted, fontSize: 12.5, fontWeight: typing ? '800' : '500', marginTop: 1 }}>
                                {typing ? tr('typing…') : daysLeft !== null && daysLeft <= 2 ? tr('This chat closes in {n} day(s)', { n: Math.max(1, daysLeft) }) : meta.closed ? tr('This chat is closed.') : ''}
                            </Text>
                        </View>
                        {canManage ? (
                            <Pressable onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={tr('More')} style={({ hovered }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? border : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '150ms' })}>
                                <Ionicons name="ellipsis-vertical" size={20} color={text} />
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}
                <ChatBackdrop>
                {items === null ? <ChatShimmer /> : (
                    <FlatList
                        inverted ListHeaderComponent={typing ? <TypingBubble /> : null} data={rows} keyExtractor={(r) => r.clientId || r.id} contentContainerStyle={{ paddingHorizontal: desk ? 32 : 12, paddingVertical: desk ? 14 : 8 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
                        ListEmptyComponent={<View style={{ alignItems: 'center', marginTop: 40 }}>{/* no flip here: an inverted list already turns its empty state the right way up */}<Ionicons name="chatbubbles-outline" size={42} color={muted} /><Text style={{ color: muted, marginTop: 8, textAlign: 'center' }}>{err || tr('No messages yet. Say hello!')}</Text></View>}
                        renderItem={({ item }) => item.day
                            ? <View style={{ alignSelf: 'center', marginVertical: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, backgroundColor: alpha(muted, 0.16) }}><Text style={{ color: muted, fontWeight: '800', fontSize: 11.5 }}>{dayLabel(item.day)}</Text></View>
                            : <Bubble m={item} colors={colors} onPicture={setPic} onRetry={() => retry(item)} onActions={(msg, uri) => setActions({ m: msg, uri })} />}
                    />
                )}
                </ChatBackdrop>
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
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: desk ? 14 : 8, paddingTop: desk ? 12 : 8, paddingBottom: desk ? 12 : Math.max(insets.bottom, 8), borderTopWidth: 1, borderTopColor: border, backgroundColor: surface }}>
                        <Pressable onPress={() => setAttach(true)} hitSlop={6} disabled={busy} style={{ width: desk ? 48 : 44, height: desk ? 48 : 44, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : 1, ...(desk ? { cursor: 'pointer' } : null) }}><Ionicons name="attach" size={26} color={muted} /></Pressable>
                        <TextInput
                            value={input} onChangeText={onType} placeholder={tr('Type a message')} placeholderTextColor={muted} multiline maxLength={1000}
                            onKeyPress={desk ? (e) => { const k = e.nativeEvent; if (k.key === 'Enter' && !k.shiftKey) { e.preventDefault?.(); sendText(); } } : undefined}
                            style={[{ flex: 1, maxHeight: 120, minHeight: 44, color: text, fontSize: 15.5, borderWidth: 1, borderColor: border, borderRadius: 22, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, backgroundColor: background }, desk && { minHeight: 48, borderRadius: 24, paddingHorizontal: 20, paddingTop: 13, paddingBottom: 13, fontSize: 16, lineHeight: 22, textAlignVertical: 'center', outlineStyle: 'none', outlineWidth: 0 }]}
                        />
                        {input.trim() ? (
                            <Pressable onPress={sendText} hitSlop={6} style={{ width: desk ? 48 : 46, height: desk ? 48 : 46, borderRadius: desk ? 24 : 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginLeft: desk ? 8 : 6, ...(desk ? { cursor: 'pointer' } : null) }}><Ionicons name="send" size={20} color={onPrimary} /></Pressable>
                        ) : (
                            <Pressable onPress={startRecording} hitSlop={6} disabled={busy} style={{ width: desk ? 48 : 46, height: desk ? 48 : 46, borderRadius: desk ? 24 : 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginLeft: desk ? 8 : 6, ...(desk ? { cursor: 'pointer' } : null), opacity: busy ? 0.5 : 1 }}><Ionicons name="mic" size={22} color={onPrimary} /></Pressable>
                        )}
                    </View>
                )}
            </Animated.View>

            <Sheet visible={attach} onClose={() => setAttach(false)} title={tr('Send a photo')}>
                <Pressable onPress={() => sendPhoto('camera')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="camera-outline" size={24} color={primary} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('Take a photo')}</Text></Pressable>
                <Pressable onPress={() => sendPhoto('gallery')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="image-outline" size={24} color={primary} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('Choose from gallery')}</Text></Pressable>
            </Sheet>
            <Sheet visible={menu} onClose={() => setMenu(false)} title={tr('Conversation')}>
                {meta.closed
                    ? <Pressable onPress={() => setEnded(false)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="refresh-outline" size={24} color={primary} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('Open this conversation again')}</Text></Pressable>
                    : <Pressable onPress={() => setEnded(true)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="close-circle-outline" size={24} color={error} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('End this conversation')}</Text></Pressable>}
            </Sheet>
            <Sheet visible={!!actions} onClose={() => setActions(null)} title={tr('Message')}>
                {actions ? (() => {
                    const am = actions.m;
                    const pic = actions.uri || (am.images || [])[0];
                    return (
                        <>
                            {!am.deleted && (am.voice || pic)
                                ? <Pressable onPress={() => { setActions(null); saveIt(am.voice ? 'audio' : 'image', am.voice ? am.voice.url : pic); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="download-outline" size={24} color={primary} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{am.voice ? tr('Save or share this voice note') : tr('Save or share this picture')}</Text></Pressable>
                                : null}
                            <Pressable onPress={() => deleteMessage(am, 'me')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="trash-outline" size={24} color={text} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{isLocal(am) ? tr('Delete') : tr('Delete for me')}</Text></Pressable>
                            {canDeleteAll(am) ? <Pressable onPress={() => deleteMessage(am, 'all')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}><Ionicons name="trash" size={24} color={error} /><Text style={{ color: text, fontWeight: '800', fontSize: 16, marginLeft: 14 }}>{tr('Delete for everyone')}</Text></Pressable> : null}
                        </>
                    );
                })() : null}
            </Sheet>
            <PictureViewer uri={pic} onClose={() => setPic('')} onSave={(u) => saveIt('image', u)} />
        </View>
    );
}
