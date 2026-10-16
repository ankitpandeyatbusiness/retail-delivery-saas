import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, ListRow, SectionTitle } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchAgreements } from '../../api/legalApi';
import { errMsg } from '../../api/adminClient';
import { DOC_NAME } from './names';

const GROUPS = [
    ['Between you and the partner', ['operator_agreement'], 'platform'],
    ['Asked to agree in the apps', ['team_terms', 'owner_terms', 'rider_terms'], 'people'],
    ['Customers only read these', ['customer_terms', 'privacy'], 'catalog'],
];
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

// Every document. Everybody can read them; the supreme admin edits and presses "Send new version".
export default function AgreementsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const supreme = useSupreme();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        setErr('');
        try { setItems((await fetchAgreements()).items); } catch (e) { setErr(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <Screen title="Agreements and terms" subtitle={supreme ? 'Write, then send' : 'Read any time'} onRefresh={load}>
            {!items && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {items ? GROUPS.map(([title, keys, section]) => (
                <View key={title}>
                    <SectionTitle section={section}>{title}</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {keys.map((k, i) => {
                            const d = items.find((x) => x.key === k);
                            if (!d) return null;
                            const sub = d.currentVersion ? `Version ${d.currentVersion} · sent ${day(d.publishedAt)}` : 'Not sent yet';
                            const badge = d.stats
                                ? (d.stats.waiting ? <Badge label={`${d.stats.agreed} of ${d.stats.total} agreed`} tone="warn" /> : (d.stats.total ? <Badge label="All agreed" tone="success" /> : null))
                                : (supreme && d.draftChanged && d.currentVersion ? <Badge label="Draft changed" tone="info" /> : null);
                            return (
                                <ListRow key={k} section={section} icon="notes" title={DOC_NAME[k]} subtitle={sub} right={badge} onPress={() => nav.navigate('AgreementDoc', { key: k })} last={i === keys.length - 1} />
                            );
                        })}
                    </Card>
                </View>
            )) : null}
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.lg, lineHeight: 19 }}>
                People are asked to agree on their second visit after a version is sent (opening the app after 30 minutes away), never the first. Owners and riders are asked only after you press “Mark as handed over” on their shop.
            </Text>
        </Screen>
    );
}
