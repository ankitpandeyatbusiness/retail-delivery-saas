import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ConfirmSheet, ErrorBox, toast } from '../../components/feedback';
import { fetchPlanMigration, runPlanMigration, rollbackPlanMigration } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

const RUN = 'MOVE SHOPS TO PRO';
const BACK = 'UNDO THE MOVE';

// Phase 9: move every shop that exists today onto Pro, free for 30 days. The preview is a dry run (nothing changes). Running it takes a database backup first.
// Old open bills stay open: settle them one by one from each shop's Old rent bills. Supreme admin only.
export default function PlanMigrationScreen() {
    const t = useTheme();
    const [pv, setPv] = useState(null);
    const [err, setErr] = useState('');
    const [sheet, setSheet] = useState(null);   // 'run' | 'back'
    const [result, setResult] = useState(null);

    const load = useCallback(async () => {
        try { setPv(await fetchPlanMigration()); setErr(''); } catch (e) { setErr(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!pv) return <Screen title="Move shops to plans">{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    return (
        <Screen title="Move shops to plans" subtitle="Pro, free for 30 days" refreshing={false} onRefresh={load}>
            <Card>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg }}>{pv.counts.move} shop{pv.counts.move === 1 ? '' : 's'} would move</Text>
                <Text style={{ color: t.muted, marginTop: spacing.xs }}>
                    Each gets Pro, free until {new Date(pv.freeUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}. No charge. After that the owner sees "Choose your plan". Amounts, free-period settings, past invoices and credit notes stay as they are.
                </Text>
                <Text style={{ color: t.muted, marginTop: spacing.xs }}>{pv.counts.withOpenBills} have an old open bill (it stays open) and {pv.counts.paused} are paused (they open again). {pv.counts.skip} skipped.</Text>
                <Text style={{ color: t.muted, marginTop: spacing.xs, fontSize: font.sm }}>A database backup is taken first. If it fails, nothing moves.</Text>
                <Button title="Move the shops to Pro" icon="bolt" disabled={!pv.counts.move} onPress={() => setSheet('run')} style={{ marginTop: spacing.md }} />
            </Card>

            {result ? <Card><Text style={{ color: t.success, fontWeight: '800' }}>{result}</Text></Card> : null}

            <SectionTitle section="shops">Would move</SectionTitle>
            <Card>
                {pv.move.length ? pv.move.map((m) => (
                    <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}>
                        <Text style={{ color: t.text, flex: 1 }}>{m.name}</Text>
                        {m.billState === 'paused' ? <Badge label="paused" tone="danger" /> : null}
                        {m.openBills ? <Badge label={`old bill Rs ${m.openBills.totalRs}`} tone="warn" /> : null}
                    </View>
                )) : <Text style={{ color: t.muted }}>No shop is waiting to move.</Text>}
            </Card>

            {pv.skip.length ? (
                <>
                    <SectionTitle section="alerts">Skipped</SectionTitle>
                    <Card>
                        {pv.skip.map((m) => (
                            <View key={m.id} style={{ paddingVertical: spacing.xs }}>
                                <Text style={{ color: t.text }}>{m.name}</Text>
                                <Text style={{ color: t.muted, fontSize: font.sm }}>{m.why}</Text>
                            </View>
                        ))}
                    </Card>
                </>
            ) : null}

            <SectionTitle section="platform">Undo</SectionTitle>
            <Card>
                <Text style={{ color: t.muted }}>Puts the shops this move touched back to "no plan", and restores an old pause. A shop that has chosen or paid for a plan since is left as it is.</Text>
                <Button title="Undo the move" kind="dangerSoft" small onPress={() => setSheet('back')} style={{ marginTop: spacing.sm }} />
            </Card>

            <ConfirmSheet
                visible={sheet === 'run'}
                onClose={() => setSheet(null)}
                title="Move the shops to Pro?"
                message={`${pv.counts.move} shops get Pro free for 30 days. A backup is taken first. Type ${RUN} to confirm.`}
                confirmLabel="Move now"
                needReason
                reasonLabel={`Type: ${RUN}`}
                onConfirm={async (v) => {
                    try { const r = await runPlanMigration(v); setResult(`Moved ${r.movedCount} shops. Backup ${r.backup ? `of ${r.backup.documents} documents taken` : 'skipped'}.`); toast('Done'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
            <ConfirmSheet
                visible={sheet === 'back'}
                onClose={() => setSheet(null)}
                title="Undo the move?"
                message={`Type ${BACK} to confirm.`}
                confirmLabel="Undo"
                danger
                needReason
                reasonLabel={`Type: ${BACK}`}
                onConfirm={async (v) => {
                    try { const r = await rollbackPlanMigration(v); setResult(`Put ${r.rolledBack} shops back.`); toast('Done'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </Screen>
    );
}
