// "This feature is only available in the app": shown on the WEBSITE in place of a feature a browser cannot do (the Soundbox).
import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { tr } from '../../i18n';

export default function AppOnlyNotice({ title, text, compact }) {
    const { text: ink, muted, primary, border } = useBrand();
    return (
        <View style={{ alignItems: 'center', padding: compact ? 16 : 32, margin: compact ? 0 : 16, borderWidth: 1, borderColor: border, borderRadius: 16 }}>
            <Ionicons name="phone-portrait-outline" size={compact ? 28 : 44} color={primary} />
            <Text style={{ color: ink, fontWeight: '900', fontSize: compact ? 15 : 18, marginTop: 10, textAlign: 'center' }}>{title || tr('This feature is only available in the app')}</Text>
            <Text style={{ color: muted, marginTop: 6, textAlign: 'center', lineHeight: 20 }}>
                {text || tr('Open the shop app on your phone to use it.')}
            </Text>
        </View>
    );
}
