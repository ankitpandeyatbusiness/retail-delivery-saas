import React from 'react';
import { View, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button } from '../../components/ui';
import { SETUP_STEPS, goSetupStep } from '../../utils/setupFlow';

// "Set up the new shop": every setting, one after another. Shown right after a shop is created, and from the shop page any time.
export default function ShopSetupScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name, fresh } = useRoute().params;
    return (
        <Screen
            title={fresh ? 'Shop created' : 'Guided setup'}
            subtitle={name}
            footer={(
                <View>
                    <Button title="Start the setup" icon="next" onPress={() => goSetupStep(nav, shopId, name, 0, false)} />
                    <Button title={fresh ? 'Open the shop, I will do it later' : 'Back'} kind="outline" onPress={() => (fresh ? nav.replace('ShopDetail', { shopId, name }) : nav.goBack())} style={{ marginTop: spacing.sm }} />
                </View>
            )}
        >
            <Card>
                <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800' }}>{fresh ? `${name} is created` : 'Go through every setting'}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4, lineHeight: 19 }}>
                    {SETUP_STEPS.length} short steps, one setting group each. Every step has sensible defaults: press Skip to keep them, or change what you want and press Save and next. You can change any of it later from the shop's Settings.
                </Text>
            </Card>
            <Card padded={false} style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg }}>
                {SETUP_STEPS.map((s, i) => (
                    <View key={s.screen} style={{ flexDirection: 'row', paddingVertical: spacing.md, borderBottomWidth: i === SETUP_STEPS.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.primary, fontWeight: '800' }}>{i + 1}</Text></View>
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '800' }}>{s.title}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{s.hint}</Text>
                        </View>
                    </View>
                ))}
            </Card>
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md, textAlign: 'center' }}>At the end the set-up check shows what is still missing: logo, menu, owner, rider, payments, going live.</Text>
        </Screen>
    );
}
