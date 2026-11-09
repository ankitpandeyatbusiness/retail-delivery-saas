import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, Badge, ListRow } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchMonth, fetchNext30, shareMonthExcel } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, rupees } from '../../utils/format';

const nowKey = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const shift = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const label = (k) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const vs = (pct) => (pct === null || pct === undefined ? '' : pct === 0 ? 'same as last month' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%`);

// One month, closed: this month against last, the GST, what is still owed, the next 30 days, and the one Excel for your CA.
export default function MonthCloseScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [month, setMonth] = useState(nowKey());
    const [d, setD] = useState(null);
    const [next, setNext] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setD(null);
        try {
            const [m, n] = await Promise.all([fetchMonth(month), month === nowKey() ? fetchNext30() : Promise.resolve(null)]);
            setD(m); setNext(n); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [month]);
    useEffect(() => { load(); }, [load]);

    const download = async () => {
        setBusy(true);
        try { await shareMonthExcel(month); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not prepare the file'), 'error'); } finally { setBusy(false); }
    };

    const c = d?.current;
    return (
        <Screen title="This month" subtitle={label(month)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
                <Button small kind="outline" title="‹" onPress={() => setMonth((k) => shift(k, -1))} />
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{label(month)}</Text>
                <Button small kind="outline" title="›" disabled={month >= nowKey()} onPress={() => setMonth((k) => shift(k, 1))} />
            </View>

            {error ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonList count={4} avatar={false} /> : (
                <>
                    <Card>
                        <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700' }}>{c.netPaise < 0 ? 'LOSS' : 'NET'} {d.change.net !== null ? '· ' + vs(d.change.net) : ''}</Text>
                        <Text style={{ color: c.netPaise < 0 ? t.danger : t.success, fontSize: font.xxl, fontWeight: '800', marginTop: 2 }}>{rupeesFromPaise(c.netPaise)}</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>Income {rupeesFromPaise(c.incomePaise)} − costs {rupeesFromPaise(c.costsPaise)}</Text>
                    </Card>

                    <SectionTitle section="money">Rent</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label={`Billed ${d.change.billed !== null ? '(' + vs(d.change.billed) + ')' : ''}`} value={rupeesFromPaise(c.billedPaise)} />
                        <KeyValue label={`Collected ${d.change.collected !== null ? '(' + vs(d.change.collected) + ')' : ''}`} value={rupeesFromPaise(c.collectedPaise)} />
                        <KeyValue label="Your income from plans and fees (before GST)" value={rupeesFromPaise(c.rentIncomePaise)} />
                        <KeyValue label="SMS margin" value={rupeesFromPaise(c.smsMarginPaise)} />
                        <KeyValue label="Costs" value={'− ' + rupeesFromPaise(c.costsPaise)} last />
                    </Card>

                    <SectionTitle section="platform">GST</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label={`GST on ${d.gst.documents} payments this month`} value={rupees(d.gst.toPay)} last />
                    </Card>

                    {next ? (
                        <>
                            <SectionTitle section="catalog">Next 30 days</SectionTitle>
                            <Card style={{ paddingVertical: 0 }}>
                                <KeyValue label="Plans and fees (guessed from last month)" value={rupeesFromPaise(next.nextBillsEstimatePaise)} />
                                <KeyValue label="Costs (average of 3 months)" value={'− ' + rupeesFromPaise(next.costsEstimatePaise)} />
                                <KeyValue label="Likely" value={rupeesFromPaise(next.netEstimatePaise)} last />
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="money">For your CA</SectionTitle>
                    <Button title={`Download ${label(month)} (Excel)`} icon="receipt" onPress={download} loading={busy} />
                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>One file: summary, payments received, SMS top-ups, the GST register and expenses.</Text>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
                        <ListRow section="money" icon="receipt" title="GST register" subtitle="The same month, document by document" onPress={() => nav.navigate('GstRegister')} last />
                    </Card>
                </>
            )}
        </Screen>
    );
}
