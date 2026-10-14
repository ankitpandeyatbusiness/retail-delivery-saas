import React from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Card, IconTile, SectionTitle } from './ui';
import Icon from './Icon';

// Shown on a tab whose screens are built in a later phase: says clearly what will be here.
export default function ComingSoon({ section, icon, headline, items }) {
    const t = useTheme();
    return (
        <>
            <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                <IconTile icon={icon} section={section} size={72} />
                <Text style={{ color: t.text, fontSize: font.xl, fontWeight: '800', marginTop: spacing.lg, textAlign: 'center' }}>{headline}</Text>
                <Text style={{ color: t.muted, marginTop: 6, textAlign: 'center' }}>This section is being built. Everything below will be available here.</Text>
            </Card>
            <SectionTitle section={section}>Coming here</SectionTitle>
            <Card>
                {items.map((it, i) => (
                    <View key={it} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
                        <Icon name="check" size={18} color={t.success} />
                        <Text style={{ color: t.text, marginLeft: spacing.md, fontSize: font.md }}>{it}</Text>
                    </View>
                ))}
            </Card>
        </>
    );
}
