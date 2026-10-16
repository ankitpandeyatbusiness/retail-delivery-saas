import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, TextInput, Linking } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Button, ListRow } from '../../components/ui';
import { Segmented } from '../../components/inputs';
import { Loading, ErrorBox, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { fetchSupportOne, replySupportOne, noteSupportOne, setSupportOne } from '../../api/supportApi';
import { errMsg } from '../../api/adminClient';
import { pickImage, uploadImage } from '../../utils/upload';
import { ago } from '../../utils/format';
import { TOPIC, STATUS } from './SupportInboxScreen';

// answers you send often
const SAVED = [
    'Thanks for contacting us. We are looking into it and will update you here soon.',
    'Could you send a screenshot of the problem? It helps us find it faster.',
    'This is fixed now. Please close the app, open it again and check. Tell us if it is still wrong.',
    'We have received your payment. It can take up to 10 minutes to show in the app.',
    'We are marking this as solved. If you still need help, just reply here.',
];

function Bubble({ m }) {
    const t = useTheme();
    if (m.from === 'note') {
        return (
            <View style={{ marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: t.warnSoft, borderWidth: 1, borderStyle: 'dashed', borderColor: t.warn }}>
                <Text style={{ color: t.warn, fontWeight: '800', fontSize: font.xs }}>Private note · {m.by || 'team'} · {ago(m.at)}</Text>
                <Text style={{ color: t.text, marginTop: 3 }}>{m.text}</Text>
            </View>
        );
    }
    const mine = m.from === 'platform';
    return (
        <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: spacing.md }}>
            <View style={{ maxWidth: '88%', padding: spacing.md, borderRadius: radius.lg, backgroundColor: mine ? t.primary : t.surface, borderBottomRightRadius: mine ? 4 : radius.lg, borderBottomLeftRadius: mine ? radius.lg : 4 }}>
                <Text style={{ color: mine ? '#FFFFFF' : t.primary, fontWeight: '800', fontSize: font.xs, marginBottom: 2 }}>{mine ? (m.by || 'Support') : (m.by || 'Owner')}</Text>
                <Text style={{ color: mine ? '#FFFFFF' : t.text, lineHeight: 21 }}>{m.text}</Text>
                {m.photos?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                        {m.photos.map((u) => (
                            <Pressable key={u} onPress={() => Linking.openURL(u).catch(() => { })} style={{ marginRight: 6, marginBottom: 6 }}>
                                <Image source={{ uri: u }} style={{ width: 100, height: 100, borderRadius: radius.sm }} />
                            </Pressable>
                        ))}
                    </View>
                ) : null}
            </View>
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 3 }}>{ago(m.at)}</Text>
        </View>
    );
}

export default function SupportDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { id } = useRoute().params;
    const [x, setX] = useState(null);
    const [err, setErr] = useState('');
    const [mode, setMode] = useState('reply');   // reply | note
    const [text, setText] = useState('');
    const [photos, setPhotos] = useState([]);
    const [busy, setBusy] = useState(false);
    const [picBusy, setPicBusy] = useState(false);
    const refId = useMemo(() => `s${Date.now().toString(36)}`, []);

    const load = useCallback(async () => {
        try { setX(await fetchSupportOne(id)); setErr(''); } catch (e) { setErr(errMsg(e)); }
    }, [id]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!x) return <Screen title="Request">{err ? <ErrorBox message={err} onRetry={load} /> : <Loading />}</Screen>;
    const st = STATUS[x.status] || STATUS.open;

    const addPicture = async () => {
        if (picBusy || photos.length >= 3 || !x.shop) return;
        setPicBusy(true);
        try {
            const img = await pickImage();
            if (!img) return;
            const m = await uploadImage(String(x.shop.id), { kind: 'support', refId, ...img });
            setPhotos((p) => [...p, m.url]);
        } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setPicBusy(false); }
    };

    const send = async (resolve) => {
        if (!text.trim() || busy) return;
        setBusy(true);
        try {
            const r = mode === 'note'
                ? await noteSupportOne(id, { message: text.trim() })
                : await replySupportOne(id, { message: text.trim(), photos, ...(resolve ? { resolve: true } : {}) });
            setX(r); setText(''); setPhotos([]);
            toast(mode === 'note' ? 'Note saved (only your team sees it)' : resolve ? 'Sent and marked solved' : 'Reply sent');
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const change = async (body) => {
        try { setX(await setSupportOne(id, body)); } catch (e) { toast(errMsg(e), 'error'); }
    };

    const composer = (
        <View>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'reply', label: 'Reply to owner' }, { value: 'note', label: 'Private note' }]} />
            {mode === 'reply' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                    {SAVED.map((s, i) => (
                        <Pressable key={i} onPress={() => setText(s)} style={{ marginRight: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: t.primarySoft, maxWidth: 220 }}>
                            <Text style={{ color: t.primary, fontSize: font.xs, fontWeight: '700' }} numberOfLines={1}>{s}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            ) : null}
            {mode === 'reply' && photos.length ? (
                <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
                    {photos.map((u) => (
                        <Pressable key={u} onPress={() => setPhotos((p) => p.filter((y) => y !== u))} style={{ marginRight: 6 }}>
                            <Image source={{ uri: u }} style={{ width: 50, height: 50, borderRadius: 10 }} />
                            <View style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center' }}><Icon name="clear" size={11} color="#FFFFFF" /></View>
                        </Pressable>
                    ))}
                </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.sm }}>
                {mode === 'reply' ? (
                    <Pressable onPress={addPicture} disabled={picBusy || photos.length >= 3} style={{ width: 44, height: 44, borderRadius: 22, marginRight: spacing.sm, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: photos.length >= 3 ? 0.4 : 1 }}>
                        <Icon name="banner" size={20} color={t.primary} />
                    </Pressable>
                ) : null}
                <TextInput
                    value={text} onChangeText={setText} multiline maxLength={2000} placeholderTextColor={t.muted}
                    placeholder={mode === 'note' ? 'A note for your team (the owner never sees it)' : 'Write your answer'}
                    style={{ flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.text, paddingHorizontal: spacing.lg, paddingVertical: 10, fontSize: font.md }}
                />
            </View>
            <View style={{ flexDirection: 'row', marginTop: spacing.sm, gap: spacing.sm }}>
                <View style={{ flex: 1 }}><Button title={mode === 'note' ? 'Save note' : 'Send'} icon="send" small onPress={() => send(false)} loading={busy} disabled={!text.trim()} /></View>
                {mode === 'reply' && x.status !== 'resolved' ? <View style={{ flex: 1 }}><Button title="Send and solve" icon="ok" kind="soft" small onPress={() => send(true)} disabled={!text.trim() || busy} /></View> : null}
            </View>
        </View>
    );

    return (
        <Screen title={`Request #${x.number}`} subtitle={x.shop?.name} footer={composer}>
            <Card>
                <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800' }}>{x.subject}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8, flexWrap: 'wrap' }}>
                    <Badge label={st.label} tone={st.tone} />
                    <Badge label={TOPIC[x.category] || 'Other'} />
                    {x.rating ? <Badge label={`Rated ${x.rating.stars} of 5`} tone="success" icon="star" /> : null}
                </View>
                {x.context?.appVersion || x.context?.platform ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 8 }}>App {x.context.appVersion || '?'} · {x.context.platform || '?'}</Text> : null}
            </Card>

            {x.shop ? (
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                    <ListRow section="shops" icon="shops" title={x.shop.name} subtitle={`Billing: ${x.shop.billingState || 'n/a'} · ${x.shop.status}`} onPress={() => nav.navigate('Admin', { screen: 'ShopsTab', params: { screen: 'ShopDetail', params: { shopId: String(x.shop.id), name: x.shop.name } } })} last={!x.owner} />
                    {x.owner ? <ListRow section="riders" icon="phone" title={x.owner.name || 'Owner'} subtitle={`${x.owner.phone}${x.owner.email ? ` · ${x.owner.email}` : ''}`} onPress={() => Linking.openURL(`tel:${x.owner.phone}`)} last /> : null}
                </Card>
            ) : null}

            <Text style={{ color: t.muted, fontWeight: '700', fontSize: font.sm, marginBottom: 6 }}>Status</Text>
            <Segmented value={x.status} onChange={(v) => change({ status: v })} options={[{ value: 'open', label: 'Needs reply' }, { value: 'answered', label: 'Waiting' }, { value: 'resolved', label: 'Solved' }]} />
            <Text style={{ color: t.muted, fontWeight: '700', fontSize: font.sm, marginTop: spacing.md, marginBottom: 6 }}>Priority</Text>
            <Segmented value={x.priority} onChange={(v) => change({ priority: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} />

            <View style={{ height: spacing.lg }} />
            {x.messages.map((m) => <Bubble key={m.id} m={m} />)}
            {x.rating?.comment ? <Text style={{ color: t.muted, textAlign: 'center' }}>Owner's comment: “{x.rating.comment}”</Text> : null}
        </Screen>
    );
}
