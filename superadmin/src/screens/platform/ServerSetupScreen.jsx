import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge } from '../../components/ui';
import { Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import Icon from '../../components/Icon';
import { fetchServerSetup } from '../../api/handledApi';
import { errMsg } from '../../api/adminClient';

const LEVEL = { must: 'Needed', should: 'Recommended', optional: 'Optional' };
const TONE = { ok: 'success', missing: 'danger', test: 'warn' };
const WORD = { ok: 'Set', missing: 'Missing', test: 'Test mode' };

// What lives on the SERVER (the host's settings) and whether it is set. Never the values: only set or missing, what it is for, and where it is set.
export default function ServerSetupScreen() {
    const t = useTheme();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const load = useCallback(async () => { try { setD(await fetchServerSetup()); setError(''); } catch (e) { setError(errMsg(e)); } }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <Screen title="Server setup" subtitle="What is set on the server" onRefresh={load}>
            {!d ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList />) : (
                <>
                    <Card style={{ marginBottom: spacing.md }}>
                        <Text style={{ color: d.summary.missing || d.summary.test ? t.warn : t.success, fontWeight: '800', fontSize: font.md }}>
                            {d.summary.missing ? `${d.summary.missing} needed setting${d.summary.missing === 1 ? ' is' : 's are'} missing` : d.summary.test ? `${d.summary.test} part${d.summary.test === 1 ? ' is' : 's are'} in test mode` : 'Everything needed is set'}
                        </Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>
                            {d.summary.needsYou.length ? `Look at: ${d.summary.needsYou.join(', ')}.` : 'Nothing to do here.'}{d.production ? '' : ' (This server is not in production mode.)'}
                        </Text>
                    </Card>
                    {d.groups.map((g) => (
                        <Card key={g.id} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md, paddingRight: spacing.sm }}>{g.title}</Text>
                                <Badge label={WORD[g.status]} tone={TONE[g.status]} />
                            </View>
                            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{LEVEL[g.level]}</Text>
                            <Text style={{ color: t.text, fontSize: font.sm, marginTop: spacing.sm }}>{g.why}</Text>
                            <View style={{ marginTop: spacing.sm }}>
                                {g.items.map((i) => (
                                    <View key={i.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
                                        <Icon name={i.set ? 'ok' : 'warning'} size={16} color={i.set ? t.success : t.danger} />
                                        <Text style={{ color: t.text, fontSize: font.sm, marginLeft: 8 }}>{i.label}</Text>
                                    </View>
                                ))}
                            </View>
                            {g.status !== 'ok' ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>How: {g.how}</Text> : null}
                        </Card>
                    ))}
                    <Hint>These are secrets of the host (Render, or wherever the server runs). They are not typed in the app on purpose, so a lost phone can never leak them. The SMS and payment keys can be saved from their own screens.</Hint>
                </>
            )}
        </Screen>
    );
}
