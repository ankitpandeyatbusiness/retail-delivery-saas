import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, radius, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Badge } from '../../components/ui';
import { Loading, ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { listMedia, deleteMedia, reorderHeroes, updateShop, logoColors } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { pickImage, uploadImage } from '../../utils/upload';
import { useShopStore } from '../../store/useShopStore';
import { isHex } from '../../utils/settings';

const MAX_HERO = 5;
const BUILD = [
    { kind: 'icon', title: 'App icon', hint: 'Square PNG, shown on the phone', square: true },
    { kind: 'adaptive', title: 'Android adaptive icon', hint: 'Logo only, transparent PNG', square: true },
    { kind: 'splash', title: 'Splash logo', hint: 'Shown while the app opens', square: false },
];

function Thumb({ uri, size = 96, radiusPx = radius.md }) {
    const t = useTheme();
    return uri
        ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radiusPx, backgroundColor: t.surfaceAlt }} resizeMode="cover" />
        : <View style={{ width: size, height: size, borderRadius: radiusPx, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Icon name="banner" size={size * 0.35} color={t.muted} /></View>;
}

// Logo, hero images and the pictures built into the app (icon, splash).
export default function ShopBrandingScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const [media, setMedia] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');          // what is being uploaded right now
    const [suggest, setSuggest] = useState(null);  // colours worked out from the logo
    const [removing, setRemoving] = useState(null);

    const load = useCallback(async () => {
        try { setMedia((await listMedia(shopId)).items); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useEffect(() => { load(); if (!rec) useShopStore.getState().load(shopId); }, [load, shopId, rec]);

    const heroes = (media || []).filter((m) => m.kind === 'hero');
    const logoUrl = rec?.tenant?.logo;

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const addPicture = (kind, square) => run(kind, async () => {
        const img = await pickImage({ square });
        if (!img) return;
        const m = await uploadImage(shopId, { kind, ...img });
        if (kind === 'logo') {
            const r = await updateShop(shopId, { logo: m.url });
            useShopStore.getState().setTenant(shopId, r.tenant);
            toast('Logo updated');
        } else toast('Picture added');
        await load();
    });

    const suggestColours = () => run('colors', async () => {
        if (!logoUrl) throw Object.assign(new Error('Add a logo first'), { safe: true });
        const r = await logoColors(shopId, logoUrl);
        if (!r.suggested) { toast(r.message || 'No usable colour in this logo', 'error'); return; }
        setSuggest(r.suggested);
    });

    const applyColours = (mode) => run('apply', async () => {
        const r = await logoColors(shopId, logoUrl, mode);
        if (r.skipped?.length && !r.applied?.length) {
            toast('Not applied: this shop has colours you picked yourself. Remove one source in Brand and look.', 'error');
        } else toast(r.applied?.length ? `Colours applied: ${r.applied.length}` : 'Nothing to change');
        setSuggest(null);
        useShopStore.getState().load(shopId, { quiet: true });
    });

    const moveHero = (i, d) => run('order', async () => {
        const j = i + d;
        if (j < 0 || j >= heroes.length) return;
        const ids = heroes.map((h) => h.id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await reorderHeroes(shopId, ids);
        await load();
        useShopStore.getState().load(shopId, { quiet: true });
    });

    const body = media === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <Loading />) : (
        <>
            <SectionTitle section="shops">Logo</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Thumb uri={logoUrl} size={88} radiusPx={radius.lg} />
                    <View style={{ flex: 1, marginLeft: spacing.lg }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{logoUrl ? 'Current logo' : 'No logo yet'}</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>Shown in the customer app and on bills.</Text>
                    </View>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                    <Button style={{ flex: 1 }} small kind="soft" icon="banner" title={logoUrl ? 'Change logo' : 'Add logo'} loading={busy === 'logo'} onPress={() => addPicture('logo', false)} />
                    <Button style={{ flex: 1 }} small kind="outline" icon="palette" title="Colours from logo" loading={busy === 'colors'} disabled={!logoUrl} onPress={suggestColours} />
                </View>
                {suggest ? (
                    <View style={{ marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt }}>
                        <Text style={{ color: t.text, fontWeight: '800', marginBottom: spacing.sm }}>Colours found in the logo</Text>
                        <View style={{ flexDirection: 'row', gap: spacing.md }}>
                            {['primary', 'primaryLight', 'primaryDark'].map((k) => (
                                <View key={k} style={{ alignItems: 'center' }}>
                                    <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: isHex(suggest[k]) ? suggest[k] : t.border }} />
                                    <Text style={{ color: t.muted, fontSize: 10, marginTop: 4 }}>{k.replace('primary', '').replace(/^$/, 'main').toLowerCase()}</Text>
                                </View>
                            ))}
                        </View>
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                            <Button style={{ flex: 1 }} small title="Fill empty" loading={busy === 'apply'} onPress={() => applyColours('empty')} />
                            <Button style={{ flex: 1 }} small kind="outline" title="Replace all" loading={busy === 'apply'} onPress={() => applyColours('replace')} />
                        </View>
                    </View>
                ) : null}
            </Card>

            <SectionTitle section="orders" right={<Badge label={`${heroes.length}/${MAX_HERO}`} tone="primary" />}>Home banner pictures</SectionTitle>
            <Card>
                {heroes.length ? heroes.map((h, i) => (
                    <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i === heroes.length - 1 ? 0 : spacing.md }}>
                        <Thumb uri={h.url} size={72} />
                        <Text style={{ flex: 1, marginLeft: spacing.md, color: t.text, fontWeight: '700' }}>Picture {i + 1}</Text>
                        <Pressable onPress={() => moveHero(i, -1)} hitSlop={6} style={{ padding: 8 }}><Icon name="next" size={20} color={i === 0 ? t.border : t.text} style={{ transform: [{ rotate: '-90deg' }] }} /></Pressable>
                        <Pressable onPress={() => moveHero(i, 1)} hitSlop={6} style={{ padding: 8 }}><Icon name="next" size={20} color={i === heroes.length - 1 ? t.border : t.text} style={{ transform: [{ rotate: '90deg' }] }} /></Pressable>
                        <Pressable onPress={() => setRemoving({ id: h.id, label: `Picture ${i + 1}` })} hitSlop={6} style={{ padding: 8 }}><Icon name="trash" size={20} color={t.danger} /></Pressable>
                    </View>
                )) : <Text style={{ color: t.muted }}>No pictures yet. They appear at the top of the customer's home screen.</Text>}
                {heroes.length < MAX_HERO ? (
                    <Button style={{ marginTop: spacing.lg }} kind="soft" small icon="add" title="Add a picture" loading={busy === 'hero'} onPress={() => addPicture('hero', false)} />
                ) : null}
            </Card>

            <SectionTitle section="platform">Built into the app</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>
                    Used when this shop's app is built. A change here reaches customers with the next app release.
                </Text>
                {BUILD.map((b, i) => {
                    const cur = (media || []).find((m) => m.kind === b.kind);
                    return (
                        <View key={b.kind} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: i === BUILD.length - 1 ? 0 : spacing.md }}>
                            <Thumb uri={cur?.url} size={56} radiusPx={14} />
                            <View style={{ flex: 1, marginLeft: spacing.md }}>
                                <Text style={{ color: t.text, fontWeight: '800' }}>{b.title}</Text>
                                <Text style={{ color: t.muted, fontSize: font.xs }}>{b.hint}</Text>
                            </View>
                            <Button small kind="outline" title={cur ? 'Replace' : 'Upload'} loading={busy === b.kind} onPress={() => addPicture(b.kind, b.square)} />
                        </View>
                    );
                })}
            </Card>

            <ConfirmSheet
                visible={!!removing}
                onClose={() => setRemoving(null)}
                title={`Delete ${removing?.label}?`}
                message="The picture is removed from the shop and from storage for good."
                confirmLabel="Delete"
                danger
                onConfirm={async () => {
                    try {
                        await deleteMedia(shopId, removing.id);
                        toast('Deleted');
                        await load();
                        useShopStore.getState().load(shopId, { quiet: true });
                    } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </>
    );

    return <Screen title="Branding" subtitle={name} refreshing={false}>{body}</Screen>;
}
