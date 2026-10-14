import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Button } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import Icon from '../../components/Icon';
import { fetchReadiness } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';

// Is this shop set up properly? Each line says what is missing and how to fix it.
export default function ReadinessScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [d, setD] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try { setD(await fetchReadiness(shopId)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <Screen
            title="Set-up check"
            subtitle={name}
            footer={<Button title="Open the shop" icon="shops" kind="soft" onPress={() => nav.navigate('Admin', { screen: 'ShopsTab', params: { screen: 'ShopDetail', params: { shopId, name } } })} />}
        >
            {error && !d ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonList /> : (
                <>
                    <Card>
                        <Badge label={d.ready ? 'Ready to go live' : 'Not ready yet'} tone={d.ready ? 'success' : 'warn'} icon={d.ready ? 'ok' : 'warning'} />
                        <Text style={{ color: t.text, fontSize: font.xl, fontWeight: '800', marginTop: spacing.sm }}>{d.passed} of {d.total} done</Text>
                    </Card>
                    <Card padded={false} style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg }}>
                        {d.checks.map((c, i) => (
                            <View key={c.key} style={{ flexDirection: 'row', paddingVertical: spacing.md, borderBottomWidth: i === d.checks.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                <Icon name={c.ok ? 'ok' : c.optional ? 'info' : 'warning'} size={22} color={c.ok ? t.success : c.optional ? t.muted : t.danger} />
                                <View style={{ flex: 1, marginLeft: spacing.md }}>
                                    <Text style={{ color: t.text, fontWeight: '700' }}>{c.label}{c.optional ? ' (optional)' : ''}</Text>
                                    {!c.ok ? <Text style={{ color: t.muted, fontSize: font.sm }}>{c.fix}</Text> : null}
                                </View>
                            </View>
                        ))}
                    </Card>
                </>
            )}
        </Screen>
    );
}
