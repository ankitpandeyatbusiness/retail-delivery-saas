import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, radius, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Badge } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Loading, ErrorBox, ConfirmSheet, Sheet, toast } from '../../components/feedback';
import { ZoomImage } from '../../components/ImageViewer';
import { fetchLoginBgs, setLoginBgDefault, deleteLoginBg } from '../../api/loginBgApi';
import { errMsg } from '../../api/adminClient';
import { pickImage, uploadLoginBg } from '../../utils/upload';
import { useSupreme } from '../../hooks/useSupreme';

const THUMB_W = 84;
const THUMB_H = 150;

// The pictures behind the desktop website's login page. They live on the CDN, one folder per business type
// (defaults/login-bg/<businessType>/<name>.webp), so a grocery or clothing shop can have its own set later.
// Everybody can look; only the supreme admin uploads, sets the default or deletes. A shop's own pick is made on its Branding page.
export default function LoginBackgroundsScreen() {
    const t = useTheme();
    const supreme = useSupreme();
    const [types, setTypes] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [adding, setAdding] = useState(null);     // { type, img } waiting for a name
    const [name, setName] = useState('');
    const [removing, setRemoving] = useState(null); // { type, file }

    const load = useCallback(async () => {
        try { setTypes((await fetchLoginBgs()).types); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const choose = (type) => run(`add-${type}`, async () => {
        const img = await pickImage({ square: false });
        if (!img) return;
        setName('');
        setAdding({ type, img });
    });
    const upload = () => run('upload', async () => {
        if (!name.trim()) throw Object.assign(new Error('Give the picture a name, like food-doodles-dark'), { safe: true });
        await uploadLoginBg({ businessType: adding.type, name: name.trim(), ...adding.img });
        setAdding(null);
        toast('Picture added');
        await load();
    });
    const makeDefault = (type, file) => run(`def-${type}-${file}`, async () => { await setLoginBgDefault(type, file); toast('Default changed'); await load(); });

    const body = types === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <Loading />) : (
        <>
            <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>
                The picture behind the login page of the desktop website. A shop shows its own pick (chosen on its Branding page), else the default of its business type.
                {supreme ? '' : ' Only the supreme admin can change these.'}
            </Text>
            {types.map((ty) => (
                <View key={ty.id}>
                    <SectionTitle section="platform" right={ty.status !== 'active' ? <Badge label="Not open yet" tone="neutral" /> : null}>{ty.label}</SectionTitle>
                    <Card>
                        {ty.items.length ? ty.items.map((it, i) => (
                            <View key={it.file} style={{ flexDirection: 'row', marginBottom: i === ty.items.length - 1 ? 0 : spacing.lg }}>
                                <ZoomImage source={{ uri: it.url }} style={{ width: THUMB_W, height: THUMB_H, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} resizeMode="cover" />
                                <View style={{ flex: 1, marginLeft: spacing.lg }}>
                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{it.file.replace(/\.webp$/, '')}</Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 }}>
                                        {it.isDefault ? <Badge label="Default" tone="primary" /> : null}
                                        <Badge label={it.usedBy ? `${it.usedBy} shop${it.usedBy === 1 ? '' : 's'}` : 'No shop picked it'} tone="neutral" />
                                    </View>
                                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 6 }}>{Math.max(1, Math.round(it.bytes / 1024))} KB · {ty.id}/{it.file}</Text>
                                    {supreme ? (
                                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                                            {!it.isDefault ? <Button small kind="soft" title="Make default" loading={busy === `def-${ty.id}-${it.file}`} onPress={() => makeDefault(ty.id, it.file)} /> : null}
                                            {!it.isDefault ? <Button small kind="outline" icon="trash" title="Delete" onPress={() => setRemoving({ type: ty.id, file: it.file })} /> : null}
                                        </View>
                                    ) : null}
                                </View>
                            </View>
                        )) : <Text style={{ color: t.muted }}>No picture yet. Shops of this type show a plain dark login page.</Text>}
                        {supreme ? <Button style={{ marginTop: spacing.lg }} kind="soft" small icon="add" title="Add a picture" loading={busy === `add-${ty.id}`} onPress={() => choose(ty.id)} /> : null}
                    </Card>
                </View>
            ))}

            <Sheet visible={!!adding} onClose={() => setAdding(null)} title="Name this picture">
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>
                    Small words with dashes, for example food-doodles-dark. It is saved in the {adding?.type} folder.
                </Text>
                <Field label="Name" value={name} onChangeText={setName} maxLength={50} autoCapitalize="none" placeholder="food-doodles-dark" />
                <Button style={{ marginTop: spacing.md }} title="Upload" icon="check" loading={busy === 'upload'} onPress={upload} />
            </Sheet>

            <ConfirmSheet
                visible={!!removing}
                onClose={() => setRemoving(null)}
                title="Delete this picture?"
                message="It is removed from the CDN for good. You cannot delete the default, or one a shop has picked."
                confirmLabel="Delete"
                danger
                onConfirm={async () => {
                    try { await deleteLoginBg(removing.type, removing.file); toast('Deleted'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </>
    );

    return <Screen title="Login backgrounds" subtitle="Desktop website login page" refreshing={false}>{body}</Screen>;
}
