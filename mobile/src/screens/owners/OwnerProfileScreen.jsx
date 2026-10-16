// The owner's own profile: picture, name and email (needed: bills and documents are sent there). The registered mobile number is shown but cannot be changed
// here (it is the login); contact support to change it.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, Hint, Label } from '../../components/owners/menuBits';
import { FormShimmer, LineShimmer } from '../../components/owners/shimmer';
import EmailVerifySheet from '../../components/owners/EmailVerifySheet';
import { fetchProfile, saveProfile, apiError } from '../../api/owners/shopApi';
import { deleteUpload } from '../../api/customers/shopApi';
import { pickPhoto, uploadAvatar } from '../../utils/common/photoUpload';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { themedAlert } from '../../components/common/dialog';

export default function OwnerProfileScreen() {
    const nav = useNavigation();
    const { primary, onPrimary, text, muted, border, surface } = useBrand();
    const [p, setP] = useState(null);
    const [form, setForm] = useState({ name: '', email: '' });
    const [err, setErr] = useState('');
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [emailOpen, setEmailOpen] = useState(false);

    const apply = (u) => { setP(u); setForm({ name: u.name || '' }); };
    useEffect(() => {
        fetchProfile().then(apply).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open your profile.')); });
    }, []);

    if (!p) return <FormPage title="My profile">{err ? <Empty icon="cloud-offline-outline" title="Could not open" hint={err} /> : <FormShimmer cards={2} />}</FormPage>;

    const initial = (p.name || p.phone || '?').trim().charAt(0).toUpperCase();
    const dirty = form.name.trim() !== (p.name || '');

    const save = async () => {
        const e = {};
        if (form.name.trim().length < 2) e.name = 'Enter your name (at least 2 letters)';
        if (Object.keys(e).length) { setErrors(e); showToast(Object.values(e)[0]); return; }
        setErrors({});
        setSaving(true);
        try {
            const u = await saveProfile({ name: form.name.trim() });
            apply(u);
            useAuthStore.setState((st) => (st.user ? { user: { ...st.user, name: u.name } } : {}));
            showToast('Profile saved');
        } catch (er) { useOwnerStore.getState().noteError(er); showToast(apiError(er)); } finally { setSaving(false); }
    };

    const change = async (source) => {
        if (photoBusy) return;
        let picked;
        try { picked = await pickPhoto(source, { square: true }); } catch (e) { showToast(e.safe ? e.message : 'Could not open the camera or gallery'); return; }
        if (!picked) return;
        setPhotoBusy(true);
        try {
            const up = await uploadAvatar({ uri: picked.uri, mimeType: picked.mimeType });
            setP((o) => ({ ...o, avatarUrl: up.url, avatarId: up.id }));
            showToast('Profile photo updated');
        } catch (e) { showToast(e.safe ? e.message : 'Could not update your photo'); } finally { setPhotoBusy(false); }
    };
    const remove = async () => {
        if (photoBusy || !p.avatarId) return;
        setPhotoBusy(true);
        try { await deleteUpload(p.avatarId); setP((o) => ({ ...o, avatarUrl: null, avatarId: null })); showToast('Profile photo removed'); }
        catch (e) { showToast('Could not remove your photo. Please try again'); } finally { setPhotoBusy(false); }
    };
    const photoMenu = () => themedAlert('Profile photo', 'Choose a picture for your account.', [
        { text: 'Take a photo', onPress: () => change('camera') },
        { text: 'Choose from gallery', onPress: () => change('gallery') },
        ...(p.avatarUrl ? [{ text: 'Remove photo', style: 'destructive', onPress: remove }] : []),
        { text: 'Cancel', style: 'cancel' },
    ], { icon: 'camera-outline' });

    return (
        <FormPage title="My profile" footer={<Button label="Save" icon="checkmark" busy={saving} disabled={!dirty} onPress={save} />}>
            <View style={{ alignItems: 'center', paddingVertical: 18 }}>
                <Pressable onPress={photoMenu} accessibilityLabel="Change profile photo">
                    <View style={{ width: 104, height: 104, borderRadius: 52, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: border }}>
                        {p.avatarUrl ? <Image source={{ uri: p.avatarUrl }} style={{ width: 104, height: 104 }} contentFit="cover" /> : <Text style={{ color: primary, fontSize: 40, fontWeight: '900' }}>{initial}</Text>}
                        {photoBusy ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}><LineShimmer width={104} height={104} /></View> : null}
                    </View>
                    <View style={{ position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRadius: 17, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: surface }}>
                        <Ionicons name="camera" size={16} color={onPrimary} />
                    </View>
                </Pressable>
                <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>Tap the picture to change it</Text>
            </View>

            <Group title="About you">
                <TextBox label="Your name" value={form.name} onChangeText={(x) => setForm({ ...form, name: x })} error={errors.name} maxLength={80} placeholder="e.g. Anita Rao" />
                <Label hint="Your bills and official documents are sent here. To change it we mail a code to the new address.">Email (needed)</Label>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 12, paddingHorizontal: 14, minHeight: 46 }}>
                    <Text style={{ flex: 1, color: p.email ? text : muted, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{p.email || 'Not added yet'}</Text>
                    <Pressable onPress={() => setEmailOpen(true)} hitSlop={8}><Text style={{ color: primary, fontWeight: '800' }}>{p.email ? 'Change' : 'Add'}</Text></Pressable>
                </View>
            </Group>

            <Group title="Registered mobile number">
                <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 12, paddingHorizontal: 14, minHeight: 46, backgroundColor: alpha(muted, 0.1) }}>
                    <Text style={{ flex: 1, color: muted, fontSize: 15, fontWeight: '700' }}>+91 {p.phone}</Text>
                    <Ionicons name="lock-closed" size={17} color={muted} />
                </View>
                <Hint>This is your login number, so it cannot be changed here. Please contact support if it must change.</Hint>
            </Group>
            <EmailVerifySheet visible={emailOpen} onClose={() => setEmailOpen(false)} title="Change your email" onDone={(u) => { setP((o) => ({ ...o, email: u.email, emailRequired: false })); setEmailOpen(false); }} />
        </FormPage>
    );
}
