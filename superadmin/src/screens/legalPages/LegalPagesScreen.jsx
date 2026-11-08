import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, ListRow, SectionTitle } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchLegalPages } from '../../api/legalApi';
import { errMsg } from '../../api/adminClient';
import { DOC_NAME, GROUPS } from './names';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

// Every terms, privacy and About Us text. Everybody can read; the supreme admin edits and presses Publish. Nobody has to agree to a new text.
export default function LegalPagesScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const supreme = useSupreme();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        setErr('');
        try { setItems((await fetchLegalPages()).items); } catch (e) { setErr(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <Screen title="Terms and policies" subtitle={supreme ? 'Edit, then publish' : 'Read any time'} onRefresh={load}>
            {!items && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {items ? GROUPS.map(([title, keys, section]) => (
                <View key={title}>
                    <SectionTitle section={section}>{title}</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {keys.map((k, i) => {
                            const d = items.find((x) => x.key === k);
                            if (!d) return null;
                            const sub = d.currentNo ? `Version ${d.currentNo} · published ${day(d.publishedAt)}${d.publishedBy ? ` by ${d.publishedBy}` : ''}` : 'Built-in text, not edited yet';
                            const badge = supreme && d.hasDraft ? <Badge label="Draft saved" tone="info" /> : null;
                            return <ListRow key={k} section={section} icon="notes" title={DOC_NAME[k]} subtitle={sub} right={badge} onPress={() => nav.navigate('LegalPageEdit', { key: k })} last={i === keys.length - 1} />;
                        })}
                    </Card>
                </View>
            )) : null}
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.lg, lineHeight: 19 }}>
                When you press Publish, the new text shows at once in every app and on the public web pages. Nobody is asked to agree: using the app means accepting. Every published text is kept, so you can go back to an old one.
            </Text>
        </Screen>
    );
}
