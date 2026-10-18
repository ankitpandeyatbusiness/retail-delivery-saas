// "Language": a sheet with the six languages in their own letters. Used on the login page, the customer's Account, the owner's menu and
// the rider's Profile. Changing the language redraws the app in it at once.
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { LANGS, useLang, tr } from '../../i18n';

export default function LanguageSheet({ visible, onClose }) {
    const { surface, text, muted, border, primary } = useBrand();
    const insets = useSafeAreaInsets();
    const lang = useLang((s) => s.lang);
    const setLanguage = useLang((s) => s.setLanguage);
    const pick = async (code) => { onClose(); if (code !== lang) await setLanguage(code); };
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={[s.sheet, { backgroundColor: surface, borderTopColor: border, paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
                    <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: border, marginBottom: 10 }} />
                    <Text style={{ color: text, fontSize: 18, fontWeight: '900', marginBottom: 4 }}>{tr('Language')}</Text>
                    <ScrollView>
                        {LANGS.map((l) => (
                            <Pressable key={l.code} onPress={() => pick(l.code)} style={({ pressed }) => [s.row, { borderBottomColor: border }, pressed && { opacity: 0.7 }]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontSize: 17, fontWeight: '800' }}>{l.native}</Text>
                                    <Text style={{ color: muted, fontSize: 12.5, fontWeight: '600' }}>{l.name}{l.beta ? ' · Beta' : ''}</Text>
                                </View>
                                {lang === l.code ? <Ionicons name="checkmark-circle" size={24} color={primary} /> : null}
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const s = StyleSheet.create({
    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingHorizontal: 16, maxHeight: '80%' },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
});
