// The big pictures on the login screen and the top of the home screen. The owner adds up to 5, removes and re-orders them.
// With none, the app shows the platform's own pictures.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { FormPage, Group, Hint } from '../../components/owners/menuBits';
import { Skel } from '../../components/common/motion';
import { fetchHeroes, reorderHeroes, deleteUpload, apiError } from '../../api/owners/shopApi';
import { pickImage, uploadImage } from '../../utils/owners/upload';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { tr } from '../../i18n';

export default function OwnerHeroScreen() {
    const { primary, border, error, text, surface } = useBrand();
    const [list, setList] = useState(null);
    const [max, setMax] = useState(5);
    const [busy, setBusy] = useState('');
    const load = useCallback(() => fetchHeroes().then((r) => { setList(r.items || []); setMax(r.max || 5); }).catch((e) => { setList((l) => l || []); showToast(apiError(e)); }), []);
    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (busy) return;
        setBusy('add');
        try {
            const img = await pickImage();
            if (!img) return;
            await uploadImage({ kind: 'hero', ...img });
            await load();
            showToast(tr('Picture added'));
        } catch (e) { showToast(e.safe ? e.message : apiError(e)); } finally { setBusy(''); }
    };
    const remove = async (m) => {
        const yes = await ask({ title: tr('Remove this picture?'), message: tr('It is deleted for good.'), confirmText: tr('Remove'), destructive: true });
        if (!yes) return;
        setBusy(m.id);
        try { await deleteUpload(m.id); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const move = async (i, d) => {
        const j = i + d;
        if (busy || j < 0 || j >= list.length) return;
        const next = [...list];
        [next[i], next[j]] = [next[j], next[i]];
        setList(next);
        setBusy('order');
        try { await reorderHeroes(next.map((x) => x.id)); } catch (e) { showToast(apiError(e)); await load(); } finally { setBusy(''); }
    };

    const round = (name, onPress, off, bg) => (
        <Pressable onPress={onPress} disabled={off} hitSlop={6} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: bg || alpha('#000000', 0.55), opacity: off ? 0.35 : 1 }}>
            <Ionicons name={name} size={18} color="#FFFFFF" />
        </Pressable>
    );

    return (
        <FormPage title={tr('Login and home pictures')}>
            <Group title={tr('Your pictures')} hint={tr('These big pictures slide on the login screen and the top of the home screen. Wide pictures look best. Up to {n}.', { n: max })}>
                {list === null ? <Skel height={150} radius={16} /> : null}
                {(list || []).map((m, i) => (
                    <View key={m.id} style={{ marginBottom: 14 }}>
                        <Image source={{ uri: m.url }} style={{ width: '100%', height: 150, borderRadius: 16, backgroundColor: surface }} contentFit="cover" />
                        <View style={{ position: 'absolute', right: 8, top: 8, flexDirection: 'row' }}>
                            <View style={{ marginRight: 6 }}>{round('arrow-up', () => move(i, -1), i === 0)}</View>
                            <View style={{ marginRight: 6 }}>{round('arrow-down', () => move(i, 1), i === list.length - 1)}</View>
                            {round('trash', () => remove(m), false, error)}
                        </View>
                        <Text style={{ position: 'absolute', left: 10, bottom: 8, color: '#FFFFFF', fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 }}>{i + 1}</Text>
                    </View>
                ))}
                {list && list.length < max ? (
                    <Pressable onPress={add} style={{ height: 90, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: border, backgroundColor: alpha(primary, 0.06), alignItems: 'center', justifyContent: 'center' }}>
                        {busy === 'add' ? <Skel height={24} width={120} radius={8} /> : (
                            <>
                                <Ionicons name="add-circle-outline" size={26} color={primary} />
                                <Text style={{ color: text, fontWeight: '800', marginTop: 4 }}>{tr('Add a picture')}</Text>
                            </>
                        )}
                    </Pressable>
                ) : null}
                {list && !list.length ? <Hint>{tr('You have none yet, so the app shows the standard pictures.')}</Hint> : null}
            </Group>
        </FormPage>
    );
}
