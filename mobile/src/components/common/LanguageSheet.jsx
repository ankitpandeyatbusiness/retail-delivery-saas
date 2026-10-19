// "Language": a sheet with the six languages in their own letters. Used on the login page, the customer's Account, the owner's menu and
// the rider's Profile. Changing the language redraws the app in it at once.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from './kit';
import { Sheet } from '../owners/ui';
import { LANGS, useLang, tr } from '../../i18n';

export default function LanguageSheet({ visible, onClose }) {
    const { text, muted, border, primary } = useBrand();
    const lang = useLang((s) => s.lang);
    const setLanguage = useLang((s) => s.setLanguage);
    const pick = async (code) => { onClose(); if (code !== lang) await setLanguage(code); };
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Language')}>
            <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{tr('Choose the language of the app')}</Text>
            {LANGS.map((l) => {
                const on = lang === l.code;
                return (
                    <Pressable
                        key={l.code}
                        onPress={() => pick(l.code)}
                        style={({ pressed }) => [{
                            flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8,
                            borderRadius: 16, borderWidth: on ? 1.5 : 1, borderColor: on ? primary : border,
                            backgroundColor: on ? alpha(primary, 0.08) : 'transparent',
                        }, pressed && { opacity: 0.7 }]}
                    >
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontSize: 17, fontWeight: '800' }}>{l.native}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                <Text style={{ color: muted, fontSize: 12.5, fontWeight: '600' }}>{l.name}</Text>
                                {l.beta ? <View style={{ marginLeft: 8, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 99, backgroundColor: alpha(primary, 0.14) }}><Text style={{ color: primary, fontSize: 10.5, fontWeight: '800' }}>BETA</Text></View> : null}
                            </View>
                        </View>
                        <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? primary : border} />
                    </Pressable>
                );
            })}
        </Sheet>
    );
}
