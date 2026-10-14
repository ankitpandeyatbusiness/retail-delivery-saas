import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Card, Button, Badge } from './ui';
import PersonPhoto from './PersonPhoto';
import Icon from './Icon';
import { Sheet, toast } from './feedback';
import { pickImage, uploadMyPhoto } from '../utils/upload';
import { removeMyPhoto } from '../api/authApi';
import { errMsg } from '../api/adminClient';
import { useAuthStore } from '../store/useAuthStore';

/*
 * The superadmin's own card: picture (tap to add, change or remove), name, a line under it, and the tag.
 * Used in More and in My account, so both show the same picture and both can change it.
 */
export default function ProfileCard({ name, subtitle }) {
    const t = useTheme();
    const photo = useAuthStore((s) => s.admin?.photo);
    const [sheet, setSheet] = useState(false);
    const [busy, setBusy] = useState(false);

    const setPhoto = (p) => useAuthStore.setState((st) => ({ admin: { ...(st.admin || {}), photo: p } }));
    const choose = async () => {
        setSheet(false);
        try {
            const img = await pickImage({ square: true });
            if (!img) return;
            setBusy(true);
            setPhoto(await uploadMyPhoto(img));
            toast('Profile picture saved');
        } catch (e) { toast(e?.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const drop = async () => {
        setSheet(false);
        setBusy(true);
        try { await removeMyPhoto(); setPhoto(null); toast('Picture removed'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <>
            <Card style={{ paddingVertical: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Pressable onPress={() => setSheet(true)} hitSlop={6} style={{ width: 76, height: 76 }}>
                        <PersonPhoto section="platform" uri={photo} name={name || 'Superadmin'} size={76} />
                        {busy ? (
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 38, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                                <ActivityIndicator color="#FFFFFF" />
                            </View>
                        ) : null}
                        <View style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: t.primary, borderWidth: 2, borderColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="edit" size={14} color="#FFFFFF" />
                        </View>
                    </Pressable>
                    <View style={{ flex: 1, marginLeft: spacing.lg }}>
                        <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800' }} numberOfLines={1}>{name || 'Superadmin'}</Text>
                        {subtitle ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
                        <View style={{ marginTop: spacing.sm }}><Badge label="Superadmin" tone="primary" icon="crown" /></View>
                    </View>
                </View>
            </Card>
            <Sheet visible={sheet} onClose={() => setSheet(false)} title="Profile picture">
                <Button title={photo ? 'Choose a new picture' : 'Choose a picture'} icon="banner" onPress={choose} />
                {photo ? <Button title="Remove my picture" kind="dangerSoft" icon="trash" style={{ marginTop: spacing.sm }} onPress={drop} /> : null}
                <Button title="Cancel" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => setSheet(false)} />
            </Sheet>
        </>
    );
}
