import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, SectionTitle } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchMoneyRecord, answerMoneyCheck } from '../../api/moneyRecordApi';
import { errMsg } from '../../api/adminClient';
import { rs, dayOf } from '../../components/broughtByBits';

const monthNow = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const shift = (m, by) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return d.toISOString().slice(0, 7); };
const label = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const BADGE = { yes: ['Received', 'success'], no: ['Not received', 'danger'], again: ['Ask again', 'warn'], open: ['Not answered', 'neutral'] };

// What the shops paid in a month, grouped under their brand, and for each shop the developer's one question: "did you get your part?"
// Everybody with a superadmin login can read it; only the supreme admin answers. A record only: nothing here is owed or due.
export default function MoneyRecordScreen() {
    const t = useTheme();
    const supreme = useSupreme();
    const [month, setMonth] = useState(monthNow());
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [ask, setAsk] = useState(null);          // the shop whose "no" reason is being written
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (m = month) => { setErr(''); try { setR(await fetchMoneyRecord(m)); } catch (e) { setErr(errMsg(e)); } }, [month]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const go = (by) => { const m = shift(month, by); setMonth(m); setR(null); load(m); };

    const answer = async (shop, got, why) => {
        setBusy(true);
        try { await answerMoneyCheck({ month, tenantId: shop.tenantId, got, ...(got ? {} : { reason: why }) }); setAsk(null); setReason(''); await load(); }
        catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Shop money" subtitle="What the shops paid, month by month" onRefresh={() => load()}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
                <Button title="‹" small kind="outline" onPress={() => go(-1)} />
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg }}>{label(month)}</Text>
                <Button title="›" small kind="outline" disabled={month >= monthNow()} onPress={() => go(1)} />
            </View>
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={() => load()} /> : null}
            {r && !r.groups.length ? <Card><Text style={{ color: t.muted }}>No shop paid anything in {label(month)}.</Text></Card> : null}
            {r && r.groups.length ? (
                <Card>
                    <Text style={{ color: t.text, fontWeight: '900', fontSize: 20 }}>{rs(r.totals.base)}</Text>
                    <Text style={{ color: t.muted, marginTop: 2 }}>{`received from ${r.totals.shops} shop${r.totals.shops === 1 ? '' : 's'}, before GST. The developer's part: ${rs(r.totals.yourPart)}.`}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>{`Received ${r.totals.yes} · not received ${r.totals.no} · not answered ${r.totals.open + r.totals.again}`}</Text>
                </Card>
            ) : null}
            {r ? r.groups.map((g) => (
                <View key={g.brandId || g.shops[0].tenantId}>
                    <SectionTitle section="money">{g.brandId ? `${g.name} · ${rs(g.base)}` : g.name}</SectionTitle>
                    {g.shops.map((s) => {
                        const [txt, tone] = BADGE[s.state];
                        return (
                            <Card key={s.tenantId} style={{ marginBottom: spacing.md }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ color: t.text, fontWeight: '800', flex: 1, paddingRight: 8 }} numberOfLines={1}>{s.brandId && s.branchCity ? `${s.name} (${s.branchCity})` : s.name}</Text>
                                    <Badge label={txt} tone={tone} />
                                </View>
                                {s.lines.map((l, i) => (
                                    <Text key={i} style={{ color: t.muted, marginTop: 4 }}>{`${l.label}: ${rs(l.amount)}`}</Text>
                                ))}
                                <Text style={{ color: t.text, marginTop: spacing.sm, fontWeight: '700' }}>{`Paid ${rs(s.base)} · developer's part ${s.pct}% = ${rs(s.yourPart)}`}</Text>
                                <Text style={{ color: t.muted, fontSize: font.xs }}>{s.broughtBy === 'owner' ? 'Brought by the developer' : s.broughtBy === 'partner' ? 'Brought by Vivyaan' : 'Not marked, counts as Vivyaan\'s'}</Text>
                                {s.check && s.state === 'no' ? <Text style={{ color: t.warn, marginTop: 4 }}>{`Reason: ${s.check.reason}`}</Text> : null}
                                {s.check && s.state === 'again' ? <Text style={{ color: t.warn, marginTop: 4 }}>Something changed after the last answer. Please answer again.</Text> : null}
                                {s.check && (s.state === 'yes' || s.state === 'no') ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{`Answered ${dayOf(s.check.at)}${s.check.by ? ` by ${s.check.by}` : ''}`}</Text> : null}
                                {supreme ? (
                                    <View style={{ marginTop: spacing.md }}>
                                        <Text style={{ color: t.text, fontWeight: '700', marginBottom: 6 }}>{`Did you get your ${s.pct}% (${rs(s.yourPart)})?`}</Text>
                                        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                                            <Button title="Yes" small kind={s.state === 'yes' ? 'primary' : 'outline'} style={{ flex: 1 }} disabled={busy} onPress={() => answer(s, true)} />
                                            <Button title="No" small kind={s.state === 'no' ? 'primary' : 'outline'} style={{ flex: 1 }} disabled={busy} onPress={() => { setReason(s.state === 'no' ? s.check.reason : ''); setAsk(s); }} />
                                        </View>
                                    </View>
                                ) : null}
                            </Card>
                        );
                    })}
                </View>
            )) : null}
            {r && !supreme ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>You can look at this. Only the supreme admin answers.</Text> : null}

            <Sheet visible={!!ask} onClose={() => setAsk(null)} title="Why not?">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>{ask ? `${ask.name}: you did not get ${rs(ask.yourPart)}. Write the reason; it is kept with the month.` : ''}</Text>
                <Field label="Reason" placeholder="e.g. Vivyaan has not sent my share yet" hint="Why you answered No. Kept in the record for you and Vivyaan." value={reason} onChangeText={setReason} maxLength={300} />
                <Button title="Save" loading={busy} disabled={reason.trim().length < 3} onPress={() => answer(ask, false, reason.trim())} />
            </Sheet>
        </Screen>
    );
}
