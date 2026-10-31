// The conversation on an inquiry, shared by the owner's and the customer's screens, WhatsApp style: the messages in their own area (newest at the bottom,
// older ones move up, no scrollbar), a box under it, and pictures either way. Also the answers the customer gave.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Animated, ActivityIndicator, Modal, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from './kit';
import UploadThumb from './UploadThumb';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

export const STATUS_LABEL = { new: 'New', replied: 'Replied', quoted: 'Price sent', confirmed: 'Confirmed', rejected: 'Not possible', closed: 'Closed' };

export const answerText = (a) => (Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? tr('Yes') : tr('No')) : String(a.value));

// a picture opened full screen
export function PictureViewer({ uri, onClose }) {
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
                {uri ? <Image source={{ uri }} style={{ flex: 1 }} contentFit="contain" /> : null}
                <Pressable onPress={onClose} hitSlop={12} style={{ position: 'absolute', top: insets.top + 12, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={24} color="#fff" />
                </Pressable>
            </View>
        </Modal>
    );
}

// what the customer filled in, as "Question: answer" lines (pictures as small squares)
export function Answers({ answers = [], estimate }) {
    const { text, muted } = useBrand();
    const [pic, setPic] = useState('');
    return (
        <View>
            {answers.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', marginTop: 4 }}>
                    <Text style={{ color: muted, fontSize: 13, flex: 2 }}>{a.label}</Text>
                    {a.type === 'photo' && Array.isArray(a.value) ? (
                        <View style={{ flex: 3, flexDirection: 'row', flexWrap: 'wrap' }}>
                            {a.value.map((u) => <Pressable key={u} onPress={() => setPic(u)} style={{ marginRight: 6, marginBottom: 6 }}><Image source={{ uri: u }} style={{ width: 56, height: 56, borderRadius: 8 }} contentFit="cover" /></Pressable>)}
                        </View>
                    ) : <Text style={{ color: text, fontSize: 14, fontWeight: '700', flex: 3 }}>{answerText(a)}</Text>}
                </View>
            ))}
            {estimate ? <Text style={{ color: text, fontWeight: '800', marginTop: 8 }}>{tr('Estimate: about ₹{n}', { n: estimate })}</Text> : null}
            <PictureViewer uri={pic} onClose={() => setPic('')} />
        </View>
    );
}

// one message: it rises into place when it is new (not for the ones that were already there)
function Bubble({ m, mine, fresh, onPicture }) {
    const { text, muted, primary, onPrimary, surface, border } = useBrand();
    const rise = useRef(new Animated.Value(fresh ? 0 : 1)).current;
    useEffect(() => { if (fresh) Animated.timing(rise, { toValue: 1, duration: 220, useNativeDriver: true }).start(); }, [fresh, rise]);
    return (
        <Animated.View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 8, opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
            <View style={{ backgroundColor: mine ? primary : surface, borderWidth: mine ? 0 : 1, borderColor: border, borderRadius: 14, padding: 6 }}>
                {(m.images || []).length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {m.images.map((u) => (
                            <Pressable key={u} onPress={() => onPicture(u)} style={{ margin: 2 }}>
                                <Image source={{ uri: u }} style={{ width: m.images.length === 1 ? 190 : 92, height: m.images.length === 1 ? 190 : 92, borderRadius: 10 }} contentFit="cover" />
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                {m.text ? <Text style={{ color: mine ? onPrimary : text, fontSize: 15, paddingHorizontal: 6, paddingVertical: 4 }}>{m.text}</Text> : null}
            </View>
            <Text style={{ color: muted, fontSize: 10, marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{new Date(m.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
        </Animated.View>
    );
}

// The messages. They fill the space they are given (the page decides the height), always show the newest at the bottom, and have no scrollbar.
// side: 'owner' | 'customer' = whose phone this is; those messages sit on the right.
export function Bubbles({ messages = [], side }) {
    const { muted } = useBrand();
    const ref = useRef(null);
    const seen = useRef(messages.length);   // how many were there when it opened: only later ones rise into place
    const [pic, setPic] = useState('');
    const fresh = (i) => i >= seen.current;
    useEffect(() => { const t = setTimeout(() => ref.current?.scrollToEnd({ animated: true }), 60); return () => clearTimeout(t); }, [messages.length]);
    return (
        <>
            <ScrollView ref={ref} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, flexGrow: 1, justifyContent: 'flex-end' }}
                showsVerticalScrollIndicator={false} onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
                {messages.map((m, i) => <Bubble key={`${i}-${m.at}`} m={m} mine={m.from === side} fresh={fresh(i)} onPicture={setPic} />)}
                {!messages.length ? <Text style={{ color: muted, textAlign: 'center', marginVertical: 10 }}>{tr('No messages yet')}</Text> : null}
            </ScrollView>
            <PictureViewer uri={pic} onClose={() => setPic('')} />
        </>
    );
}

// The box at the bottom. onSend({ text, images }) returns a promise; the box clears when it works.
// pickMany(limit) -> [{ uri, mimeType }]; upload({ uri, mimeType, onProgress, handle }) -> the picture's https link.
export function ReplyBox({ onSend, placeholder, pickMany, upload }) {
    const { primary, onPrimary, text, muted, border, surface } = useBrand();
    const [v, setV] = useState('');
    const [busy, setBusy] = useState(false);
    const [sending, setSending] = useState([]);   // pictures still going: { key, uri, progress, handle }
    const [done, setDone] = useState([]);         // pictures that went: https links
    const stopped = useRef(new Set());
    const MAX = 3;

    const add = async () => {
        const room = MAX - done.length - sending.length;
        if (!pickMany || !upload || room <= 0) return;
        const picked = await pickMany(room);
        const batch = picked.map((p, n) => ({ ...p, key: `${Date.now()}-${n}`, progress: null, handle: {} }));
        if (!batch.length) return;
        setSending((s) => [...s, ...batch]);
        batch.forEach(async (img) => {
            try {
                const url = await upload({ uri: img.uri, mimeType: img.mimeType, handle: img.handle, onProgress: (p) => setSending((s) => s.map((x) => (x.key === img.key ? { ...x, progress: p } : x))) });
                if (!stopped.current.has(img.key)) setDone((d) => [...d, url].slice(0, MAX));
            } catch (e) { if (!stopped.current.has(img.key) && !e?.stopped) showToast(e?.safe ? e.message : tr('Could not add the photo')); }
            finally { stopped.current.delete(img.key); setSending((s) => s.filter((x) => x.key !== img.key)); }
        });
    };
    const stop = (key) => { stopped.current.add(key); sending.find((x) => x.key === key)?.handle?.cancel?.(); setSending((s) => s.filter((x) => x.key !== key)); };

    const ready = (v.trim() || done.length) && !sending.length;
    const go = async () => {
        if (!ready || busy) return;
        setBusy(true);
        try { await onSend({ text: v.trim(), images: done }); setV(''); setDone([]); } finally { setBusy(false); }
    };
    return (
        <View>
            {sending.length || done.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                    {done.map((u) => (
                        <Pressable key={u} onPress={() => setDone((d) => d.filter((x) => x !== u))} style={{ marginRight: 8, marginBottom: 6 }}>
                            <Image source={{ uri: u }} style={{ width: 64, height: 64, borderRadius: 10 }} contentFit="cover" />
                            <Ionicons name="close-circle" size={20} color={text} style={{ position: 'absolute', top: -6, right: -6 }} />
                        </Pressable>
                    ))}
                    {sending.map((x) => <View key={x.key} style={{ marginRight: 8, marginBottom: 6 }}><UploadThumb uri={x.uri} progress={x.progress} size={64} radius={10} onCancel={() => stop(x.key)} /></View>)}
                </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                {pickMany && upload ? (
                    <Pressable onPress={add} disabled={done.length + sending.length >= MAX} accessibilityRole="button" accessibilityLabel={tr('Add a photo')}
                        style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginRight: 6, opacity: done.length + sending.length >= MAX ? 0.4 : 1 }}>
                        <Ionicons name="image-outline" size={24} color={muted} />
                    </Pressable>
                ) : null}
                <View style={{ flex: 1, marginRight: 8 }}>
                    <TextInput value={v} onChangeText={setV} placeholder={placeholder || tr('Write a message')} placeholderTextColor={muted} multiline maxLength={1000}
                        style={{ minHeight: 46, maxHeight: 110, borderRadius: 23, borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15 }} />
                </View>
                <Pressable onPress={go} disabled={busy || !ready} accessibilityRole="button" accessibilityLabel={tr('Send')}
                    style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', opacity: !ready ? 0.45 : 1 }}>
                    {busy ? <ActivityIndicator color={onPrimary} size="small" /> : <Ionicons name="send" size={20} color={onPrimary} style={{ marginLeft: 2 }} />}
                </Pressable>
            </View>
        </View>
    );
}
