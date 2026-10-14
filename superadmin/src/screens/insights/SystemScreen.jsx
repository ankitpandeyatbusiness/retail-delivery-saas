import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Button, SectionTitle, KeyValue } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { fetchSystem, fetchBackups, runBackup } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { dateTime, ago } from '../../utils/format';

const dur = (s) => (s > 86400 ? `${Math.floor(s / 86400)} days` : s > 3600 ? `${Math.floor(s / 3600)} hours` : `${Math.floor(s / 60)} minutes`);

// Is the platform itself healthy: database, SMS, nightly jobs, switches and backups.
export default function SystemScreen() {
    const t = useTheme();
    const [sys, setSys] = useState(null);
    const [bk, setBk] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [confirm, setConfirm] = useState(false);

    const load = useCallback(async () => {
        try {
            const [s, b] = await Promise.all([fetchSystem(), fetchBackups()]);
            setSys(s); setBk(b); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const run = async () => {
        try {
            const r = await runBackup();
            toast(`Backup saved: ${r.collections} collections, ${r.documents} records`);
            await load();
        } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };

    return (
        <Screen title="System and backups" subtitle="Is everything running" refreshing={refreshing} onRefresh={refresh}>
            {error && !sys ? <ErrorBox message={error} onRetry={load} /> : !sys || !bk ? <SkeletonDashboard /> : (
                <>
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }}>Database</Text>
                            <Badge label={sys.database.ok ? `Working · ${sys.database.pingMs} ms` : 'Not answering'} tone={sys.database.ok ? 'success' : 'danger'} />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
                            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }}>SMS provider</Text>
                            <Badge label={sys.sms.failing ? `Failing (${sys.sms.failedLast10Min} failed in 10 min)` : 'Working'} tone={sys.sms.failing ? 'danger' : 'success'} />
                        </View>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>
                            Server running for {dur(sys.uptimeSec)} · {sys.env} · Node {sys.node}
                        </Text>
                    </Card>

                    <SectionTitle section="riders">Backups</SectionTitle>
                    <Card>
                        <Badge label={bk.stale ? 'No backup in the last day' : 'Backed up'} tone={bk.stale ? 'danger' : 'success'} icon={bk.stale ? 'warning' : 'ok'} />
                        <Text style={{ color: t.text, marginTop: spacing.sm }}>
                            {bk.newest ? `Newest daily backup: ${bk.newest}` : 'No backup exists yet.'}
                        </Text>
                        <Text style={{ color: t.muted, fontSize: font.sm }}>Kept: {bk.daily.length} daily, {bk.weekly.length} weekly. A backup runs by itself every night at 2 am.</Text>
                        <Button title="Back up now" icon="box" kind="soft" small loading={bk.running} style={{ marginTop: spacing.md }} onPress={() => setConfirm(true)} />
                    </Card>
                    {bk.daily.length || bk.weekly.length ? (
                        <Card style={{ marginTop: spacing.md, paddingVertical: 0 }}>
                            {bk.daily.map((d, i) => <KeyValue key={d} label={`Daily ${d}`} value={i === 0 ? 'Newest' : ''} last={i === bk.daily.length - 1 && !bk.weekly.length} />)}
                            {bk.weekly.map((w, i) => <KeyValue key={w} label={`Weekly ${w}`} value="" last={i === bk.weekly.length - 1} />)}
                        </Card>
                    ) : null}

                    <SectionTitle section="settings">Nightly jobs</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        {sys.jobs.map((j, i) => (
                            <KeyValue key={j.name} label={`${j.label} (${j.hour}:00)`} value={j.lastAt ? ago(j.lastAt) : 'Never ran'} last={i === sys.jobs.length - 1} />
                        ))}
                    </Card>

                    <SectionTitle section="alerts">Switches</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {sys.flags.map((f, i) => (
                            <View key={f.name} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: i === sys.flags.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                <Text style={{ color: t.text, flex: 1, fontWeight: '600' }}>{f.name}</Text>
                                <Badge label={f.on ? 'On' : 'Off'} tone={f.warn ? 'danger' : f.on ? 'info' : 'neutral'} />
                            </View>
                        ))}
                    </Card>
                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>
                        Checked {dateTime(sys.now)}. In production, any "test mode" switch that is On is shown in red: it means real customers are not getting real SMS, payments, mail or files.
                    </Text>
                </>
            )}
            <ConfirmSheet
                visible={confirm}
                onClose={() => setConfirm(false)}
                title="Back up now?"
                message="This copies the whole database to the private backup storage. It can take a minute."
                confirmLabel="Back up"
                onConfirm={run}
            />
        </Screen>
    );
}
