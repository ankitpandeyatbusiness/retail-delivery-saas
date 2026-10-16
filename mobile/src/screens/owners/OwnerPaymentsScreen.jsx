// Online money: every payment received, refund and bill in one list, plus refunds and chargebacks on their own tabs.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Empty, Pill, Button, Stat } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import { fetchPaymentsReport, fetchRefunds, fetchDisputes, fetchTransactions, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { periodRange, MOVES, REFUND_STATE, DISPUTE_STATE } from '../../utils/owners/moneyRules';
import { rupees, ago } from '../../utils/owners/riderRules';
import { dayTime } from '../../utils/owners/orderFlow';
import { ListShimmer } from '../../components/owners/shimmer';

const RANGES = [['7', '7 days'], ['30', '30 days'], ['month', 'This month']];

export default function OwnerPaymentsScreen() {
    const nav = useNavigation();
    const { background, muted, text, ok, error, primary } = useBrand();
    const [tab, setTab] = useState('moves');
    const [range, setRange] = useState('30');
    const [move, setMove] = useState('');
    const [report, setReport] = useState(null);
    const [list, setList] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    const run = useCallback(async (p = 1) => {
        if (p === 1) { setList(null); setErr(''); }
        try {
            const r = periodRange(range);
            let items; let hasMore = false;
            if (tab === 'moves') {
                const x = await fetchTransactions({ ...r, ...(move ? { category: move } : {}), page: p, limit: 20 });
                items = x.items; hasMore = x.page * x.limit < x.total;
            } else if (tab === 'refunds') {
                const x = await fetchRefunds({ page: p }); items = x.items; hasMore = x.hasMore;
            } else { const x = await fetchDisputes(); items = x.items; }
            setList((old) => (p === 1 ? items : [...(old || []), ...items]));
            setMore(hasMore); setPage(p);
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load this list.')); setList((x) => x || []); }
    }, [tab, range, move]);

    useEffect(() => { run(1); }, [run]);
    useEffect(() => { fetchPaymentsReport(periodRange(range)).then(setReport).catch(() => { }); }, [range]);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Online money" />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                {report ? (
                    <Card>
                        <View style={{ flexDirection: 'row' }}>
                            <Stat label="Received" value={rupees(report.captured.paise)} hint={`${report.captured.count} payments`} />
                            <Stat label="Refunded" value={rupees(report.refunded.paise)} hint={`${report.refunded.count} refunds`} />
                            <Stat label="Kept" value={rupees(report.netPaise)} color={ok} />
                        </View>
                        {report.refundsOnTheWay.count || report.disputesOpen || report.disputesLost.count ? (
                            <View style={{ marginTop: 10 }}>
                                {report.refundsOnTheWay.count ? <Text style={{ color: muted, fontSize: 12 }}>{report.refundsOnTheWay.count} refunds on the way ({rupees(report.refundsOnTheWay.paise)})</Text> : null}
                                {report.disputesOpen ? <Text style={{ color: error, fontSize: 12 }}>{report.disputesOpen} chargebacks waiting for an answer</Text> : null}
                                {report.disputesLost.count ? <Text style={{ color: error, fontSize: 12 }}>{report.disputesLost.count} chargebacks lost ({rupees(report.disputesLost.paise)})</Text> : null}
                            </View>
                        ) : null}
                    </Card>
                ) : null}

                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['moves', 'Money'], ['refunds', 'Refunds'], ['disputes', 'Chargebacks']]} value={tab} onChange={(x) => { setTab(x); setMove(''); }} style={{ marginTop: 0 }} />
                    {tab === 'moves' ? <Chips options={RANGES} value={range} onChange={setRange} style={{ marginTop: 0 }} /> : null}
                    {tab === 'moves' ? <Chips options={MOVES} value={move} onChange={setMove} style={{ marginTop: 0 }} /> : null}
                </View>

                <Card>
                    {list === null ? <ListShimmer count={2} rows /> : null}
                    {err ? <Text style={{ color: error }}>{err}</Text> : null}
                    {list && !list.length && !err ? <Text style={{ color: muted }}>{tab === 'moves' ? 'Nothing in this period.' : tab === 'refunds' ? 'No refunds yet.' : 'No chargebacks. Good.'}</Text> : null}

                    {tab === 'moves' ? (list || []).map((t, i) => (
                        <MoneyRow
                            key={String(t.id)}
                            title={t.label + (t.orderNo ? ` · #${t.orderNo}` : '')}
                            note={`${dayTime(t.at)}${t.status === 'pending' ? ' · pending' : ''}`}
                            value={`${t.direction === 'in' ? '+' : '−'}${rupees(t.amountPaise)}`}
                            color={t.status === 'pending' ? muted : t.direction === 'in' ? ok : text}
                            last={i === list.length - 1}
                        />
                    )) : null}

                    {tab === 'refunds' ? (list || []).map((r, i) => (
                        <MoneyRow key={String(r.id)} title={`Order #${r.orderNo ?? ''}`} note={`${REFUND_STATE[r.status] || r.status} · ${ago(r.createdAt)}${r.reason ? ` · ${r.reason}` : ''}`} value={rupees(r.amountPaise)} color={r.status === 'failed' ? error : text} last={i === list.length - 1} />
                    )) : null}

                    {tab === 'disputes' ? (list || []).map((d, i) => (
                        <MoneyRow
                            key={String(d.id)}
                            title={`Order #${d.orderNo ?? ''} · ${DISPUTE_STATE[d.status] || d.status}`}
                            note={d.respondBy && ['created', 'under_review', 'action_required'].includes(d.status) ? `Answer by ${dayTime(d.respondBy)}` : ago(d.createdAt)}
                            value={rupees(d.amountPaise)}
                            color={d.status === 'lost' ? error : text}
                            last={i === list.length - 1}
                        />
                    )) : null}

                    {more ? <View style={{ marginTop: 8 }}><Button label="Show more" kind="ghost" onPress={() => run(page + 1)} /></View> : null}
                </Card>
                {tab === 'disputes' && list?.length ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16 }}>Questions about a chargeback? Please contact support.</Text> : null}
            </ScrollView>
        </View>
    );
}
