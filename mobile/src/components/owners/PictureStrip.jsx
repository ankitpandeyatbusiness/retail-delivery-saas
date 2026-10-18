// Up to 3 small pictures with a plus button, for a help request or a reply. Each picture is uploaded the moment it is chosen,
// so what the strip holds are links ready to send. onChange(list of links).
import React, { useState } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Skel } from '../common/motion';
import { pickImage, uploadImage } from '../../utils/owners/upload';
import { MAX_PICTURES } from '../../utils/owners/supportRules';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

export default function PictureStrip({ value, onChange, refId, size = 64 }) {
    const { primary, border, muted, error } = useBrand();
    const [busy, setBusy] = useState(false);
    const add = async () => {
        if (busy || value.length >= MAX_PICTURES) return;
        setBusy(true);
        try {
            const img = await pickImage();
            if (!img) return;
            const m = await uploadImage({ kind: 'support', refId, via: 'support', ...img });
            onChange([...value, m.url]);
        } catch (e) { showToast(e.safe ? e.message : tr('Could not add that picture')); } finally { setBusy(false); }
    };
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            {value.map((u) => (
                <View key={u} style={{ marginRight: 8, marginBottom: 6 }}>
                    <Image source={{ uri: u }} style={{ width: size, height: size, borderRadius: 12 }} contentFit="cover" />
                    <Pressable onPress={() => onChange(value.filter((x) => x !== u))} hitSlop={8} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: error, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="close" size={14} color="#FFFFFF" />
                    </Pressable>
                </View>
            ))}
            {busy ? <Skel width={size} height={size} radius={12} style={{ marginRight: 8, marginBottom: 6 }} /> : null}
            {value.length < MAX_PICTURES && !busy ? (
                <Pressable onPress={add} style={{ width: size, height: size, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: border, backgroundColor: alpha(primary, 0.06), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
                    <Ionicons name="image-outline" size={22} color={primary} />
                    <Text style={{ color: muted, fontSize: 10, marginTop: 2 }}>{tr('Add')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}
