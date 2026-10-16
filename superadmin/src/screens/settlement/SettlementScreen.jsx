import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, SectionTitle, Button, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { EntryRow, CostSheet, rs, nameOf } from '../../components/settlementBits';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchSettlementSummary, fetchSettlementEntries, shareSettlement } from '../../api/settlementApi';
import { errMsg } from '../../api/adminClient';

const FILTERS = [['open', 'Open'], ['late', 'Late'], ['paid', 'Paid'], ['', 'All']];

// one side of the money: "Vivek owes Ankit", with the amount
function Side({ label, value, tone }) {
    const t = useTheme();
    const color = tone === 'bad' && value > 0 ? t.danger : t.text;
    return (
        <View style={{ flexGrow: 1, flexBasis: 140, minWidth: 130, padding: spacing.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt || t.bg }}>
            <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }} numberOfLines={2}>{label}</Text>
            <Text style={{ color, fontSize: font.xl, fontWeight: '900', marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{rs(value)}</Text>
        </View>
    );
}

// The common sheet between the two partners: who owes whom. Numbers only; the money moves outside the app.
// Everybody can read and download it; only the supreme admin changes it. The partner can add an "I have paid" note.
export default function SettlementScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const supreme = useSupreme();
    const [filter, setFilter] = useState('open');
    const [sum, setSum] = useState(null);
    const [rows, setRows] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [costOpen, setCostOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (p = 1) => {
        setErr('');
        try {
            const [s, r] = await Promise.all([fetchSettlementSummary(), fetchSettlementEntries({ status: filter || undefined, page: p, limit: 30 })]);
            setSum(s);
            setRows((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p);
        } catch (e) { setErr(errMsg(e)); }
    }, [filter]);
    useFocusEffect(useCallback(() => { load(1); }, [load]));

    const download = async () => {
        setBusy(true);
        try { await shareSettlement(); } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const cfg = sum?.config;
    const net = sum?.netOwed;

    return (
        <Screen title="Settlement sheet" subtitle="Who owes whom" onRefresh={() => load(1)}>
            {!sum && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={() => load(1)} /> : null}
            {sum ? (
                <>
                    <Card>
                        <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '800', letterSpacing: 0.6 }}>RIGHT NOW</Text>
                        <Text style={{ color: t.text, fontSize: font.xl, fontWeight: '900', marginTop: 4 }}>
                            {net ? `${nameOf(cfg, net.from)} pays ${nameOf(cfg, net.to)} ${rs(net.amount)}` : 'All square. Nothing to pay.'}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                            <Side label={`${cfg.partnerName} owes ${cfg.ownerName}`} value={sum.partnerOwesOwner} tone="bad" />
                            <Side label={`${cfg.ownerName} owes ${cfg.partnerName}`} value={sum.ownerOwesPartner} />
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                            {sum.lateRows ? <Badge label={`${sum.lateRows} late · ${rs(sum.lateAmount)}`} tone="danger" /> : <Badge label="Nothing late" tone="success" />}
                            {sum.claims ? <Badge label={`${sum.claims} “I have paid” to confirm`} tone="info" /> : null}
                        </View>
                        <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>Numbers only. The money moves outside the app. {cfg.partnerName} pays within {cfg.payDays} days of each payment.</Text>
                    </Card>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Excel" icon="download" kind="soft" onPress={download} loading={busy} /></View>
                        {supreme ? <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Add shared cost" icon="add" onPress={() => setCostOpen(true)} /></View> : null}
                        {supreme ? <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Names and ratios" icon="settings" kind="outline" onPress={() => nav.navigate('SettlementSettings')} /></View> : null}
                    </View>

                    <SectionTitle section="money">The sheet</SectionTitle>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} style={{ flexGrow: 0 }}>
                        {FILTERS.map(([v, label]) => <Chip key={label} label={label} active={filter === v} onPress={() => setFilter(v)} />)}
                    </ScrollView>
                    {rows === null ? <SkeletonList /> : rows.length ? (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                            {rows.map((r, i) => <EntryRow key={r._id} row={r} cfg={cfg} last={i === rows.length - 1} onPress={() => nav.navigate('SettlementEntry', { id: r._id })} />)}
                        </Card>
                    ) : <Text style={{ color: t.muted, fontSize: font.sm }}>Nothing here. A row appears by itself when a shop pays rent, a setup fee or an SMS top-up.</Text>}
                    {more ? <View style={{ marginTop: spacing.md }}><Button title="Show more" kind="outline" onPress={() => load(page + 1)} /></View> : null}
                    {!supreme ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.lg }}>You can see everything here, but only the supreme admin changes it. If you paid something, open its row and press “I have paid”.</Text> : null}
                    {cfg ? <CostSheet visible={costOpen} onClose={() => setCostOpen(false)} cfg={cfg} onDone={() => load(1)} /> : null}
                </>
            ) : null}
        </Screen>
    );
}
