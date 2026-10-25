// Transactions: every rupee in and out of the shop, online AND offline, like the history in a payments app. Filter by day, month or any range, by money in or
// out, by how it was paid, by type, or by an order number. Tap a row for everything about it. This is the shop's one list of what really happened.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, Stat, Button, Empty, Sheet, Field } from '../../components/owners/ui';
import { CalendarSheet, MonthSheet } from '../../components/owners/CalendarSheet';
import { StatShimmer, ListShimmer } from '../../components/owners/shimmer';
import { callPhone } from '../../components/owners/orderBits';
import { fetchMoneyAll, moneyAllPath, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees } from '../../utils/owners/riderRules';
import { downloadAndOpen } from '../../utils/owners/files';
import { showToast } from '../../components/customers/shop';
import { PERIODS, KIND, KIND_CHIPS, HOW_CHIPS, DIRECTION_CHIPS, periodParams, periodTitle, dayKey, dayLabel, timeOf, fullStamp, subtitle } from '../../utils/owners/txRules';
import { tr } from '../../i18n';

function Pills({ options, value, onChange }) {
    const { primary, onPrimary, text, border } = useBrand();
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }} style={{ marginBottom: 8 }}>
            {options.map(([v, label]) => {
                const on = v === value;
                return (
                    <Pressable key={String(v)} onPress={() => onChange(v)} style={{ marginRight: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
                        <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{tr(label)}</Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

function Line({ label, value, onPress, strong }) {
    const { text, muted, primary, border } = useBrand();
    if (value === null || value === undefined || value === '') return null;
    return (
        <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', paddingVertical: 9, borderBottomWidth: 0.5, borderBottomColor: border }}>
            <Text style={{ color: muted, width: 112, fontSize: 13 }}>{label}</Text>
            <Text selectable style={{ color: onPress ? primary : text, flex: 1, fontWeight: strong ? '900' : '700', fontSize: 14 }}>{value}</Text>
        </Pressable>
    );
}

function Detail({ x, onClose, onOpenOrder }) {
    const { text, muted, ok, error } = useBrand();
    if (!x) return <Sheet visible={false} onClose={onClose} title="" />;
    const k = KIND[x.category] || {};
    const m = x.meta || {};
    const tip = m.tipPaise ? rupees(m.tipPaise) : null;
    return (
        <Sheet visible onClose={onClose} title={tr(x.label)}>
            <View style={{ alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: x.direction === 'in' ? ok : text, fontWeight: '900', fontSize: 30 }}>{x.direction === 'in' ? '+' : '−'}{rupees(x.amountPaise)}</Text>
                <Text style={{ color: x.status === 'pending' ? error : muted, fontWeight: '800', marginTop: 2 }}>{x.status === 'pending' ? tr('Not paid yet') : x.direction === 'in' ? tr('Received') : tr('Paid out')}</Text>
            </View>
            <Line label={tr('Date and time')} value={fullStamp(x.at)} strong />
            <Line label={tr('How')} value={x.howLabel ? tr(x.howLabel) : null} />
            <Line label={tr(x.direction === 'in' ? 'Received by' : 'Sent by')} value={x.by} />
            <Line label={tr('Customer')} value={x.customer} />
            <Line label={tr('Phone')} value={x.phone} onPress={x.phone ? () => callPhone(x.phone) : undefined} />
            <Line label={tr('Order')} value={x.orderNo ? `#${x.orderNo}${x.orderType ? ' · ' + tr(x.orderType === 'dine_in' ? 'Dine in' : x.orderType === 'pickup' ? 'Pickup' : 'Delivery') : ''}` : null} onPress={x.orderId ? () => onOpenOrder(x.orderId) : undefined} />
            <Line label={tr('Table')} value={x.table ? `${x.table}${x.party ? ' · bill ' + x.party : ''}` : null} />
            <Line label={tr('Payment method')} value={m.method ? String(m.method).toUpperCase() : null} />
            <Line label={tr('Reference')} value={x.ref} />
            <Line label={tr('Tip (not counted)')} value={tip} />
            <Line label={tr('Already refunded')} value={m.refundedPaise ? rupees(m.refundedPaise) : null} />
            <Line label={tr('Reason')} value={m.reason || m.reasonCode} />
            <Line label={tr('Month')} value={m.period} />
            <Line label={tr('Note')} value={x.note} />
            <Line label={tr('Entry id')} value={x.id} />
            <Text style={{ color: muted, fontSize: 11.5, marginTop: 10 }}>{tr('Taken from the real records of your shop. Nothing here can be edited.')}</Text>
        </Sheet>
    );
}

export default function OwnerTxTabScreen() {
    const nav = useNavigation();
    const { background, text, muted, ok, primary, border, surface } = useBrand();
    const [period, setPeriod] = useState('month');
    const [pick, setPick] = useState({});
    const [direction, setDirection] = useState('');
    const [how, setHow] = useState('');
    const [category, setCategory] = useState('');
    const [qText, setQText] = useState('');
    const [qApplied, setQApplied] = useState('');
    const [data, setData] = useState(null);
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [more, setMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [sheet, setSheet] = useState('');   // 'day' | 'range' | 'month'
    const [open, setOpen] = useState(null);
    const [busy, setBusy] = useState(false);
    const seq = useRef(0);

    const params = useCallback(() => ({
        ...periodParams(period, pick), ...(direction ? { direction } : {}), ...(how ? { how } : {}), ...(category ? { category } : {}), ...(qApplied ? { q: qApplied } : {}),
    }), [period, pick, direction, how, category, qApplied]);

    const load = useCallback(async (p = 1, quiet = false) => {
        const mine = ++seq.current;
        if (!quiet && p === 1) { setData(null); setItems([]); }
        setErr('');
        try {
            const r = await fetchMoneyAll({ ...params(), page: p });
            if (mine !== seq.current) return;
            setData(r); setPage(p); setMore(r.page * r.limit < r.total);
            setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items]));
        } catch (e) { if (mine === seq.current) { useOwnerStore.getState().noteError(e); setErr(apiError(e, tr('Could not load your transactions.'))); } }
    }, [params]);
    useEffect(() => { load(1); }, [load]);

    const choose = (v) => { if (v === 'day') setSheet('day'); else if (v === 'range') setSheet('range'); else if (v === 'monthpick') setSheet('month'); else { setPeriod(v); setPick({}); } };
    const picked = (kind, v) => { setPick(v); setPeriod(kind); };
    const csv = async () => {
        setBusy(true);
        try { await downloadAndOpen({ path: moneyAllPath, params: { ...params(), format: 'csv' }, filename: 'transactions.csv', mime: 'text/csv', title: tr('Transactions') }); }
        catch (e) { showToast(e.safe ? e.message : tr('Could not download')); } finally { setBusy(false); }
    };
    const refresh = async () => { setRefreshing(true); await load(1, true); setRefreshing(false); };

    // grouped by day, newest first
    const groups = [];
    for (const x of items) {
        const k = dayKey(x.at);
        const g = groups[groups.length - 1];
        if (g && g.day === k) g.rows.push(x); else groups.push({ day: k, rows: [x] });
    }
    const t = data?.totals;

    return (
        <OwnerScreen title={tr('Transactions')} onRefresh={refresh} refreshing={refreshing}>
            <Pills options={PERIODS} value={period} onChange={choose} />
            <Pills options={DIRECTION_CHIPS} value={direction} onChange={setDirection} />
            <Pills options={HOW_CHIPS} value={how} onChange={setHow} />
            <Pills options={KIND_CHIPS} value={category} onChange={setCategory} />
            <View style={{ paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <View style={{ flex: 1 }}>
                    <Field value={qText} onChangeText={(v) => setQText(v.replace(/[^0-9#]/g, ''))} placeholder={tr('Search by order number')} keyboardType="number-pad" returnKeyType="search" onSubmitEditing={() => setQApplied(qText.replace('#', ''))} />
                </View>
                {qApplied ? <Pressable onPress={() => { setQText(''); setQApplied(''); }} hitSlop={8} style={{ marginLeft: 8 }}><Ionicons name="close-circle" size={24} color={muted} /></Pressable> : null}
            </View>

            {!data && !err ? <StatShimmer /> : null}
            {err && !data ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
            {data ? (
                <>
                    <Card>
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr(periodTitle(period, pick))}</Text>
                        <View style={{ flexDirection: 'row', marginTop: 8 }}>
                            <Stat label={tr('Money in')} value={rupees(t.inPaise)} color={ok} />
                            <Stat label={tr('Money out')} value={rupees(t.outPaise)} />
                            <Stat label={tr('Kept')} value={rupees(t.netPaise)} />
                        </View>
                        {t.byHow.length ? (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
                                {t.byHow.map((h) => <Text key={h.how} style={{ color: muted, fontSize: 12.5, marginRight: 14 }}>{tr(h.label)}: <Text style={{ color: text, fontWeight: '800' }}>{rupees(h.paise)}</Text></Text>)}
                            </View>
                        ) : null}
                        {t.pending.count ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('{n} bill(s) to pay: {rupees}', { n: t.pending.count, rupees: rupees(t.pending.paise) })}</Text> : null}
                        {data.truncated ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('A lot of entries. Choose a shorter period to see every one.')}</Text> : null}
                    </Card>

                    {!items.length ? <Empty icon="swap-vertical-outline" title={tr('Nothing here')} hint={tr('No money moved in this period. Try another day or month, or remove a filter.')} /> : null}
                    {groups.map((g) => {
                        const net = g.rows.reduce((n, x) => (x.status === 'pending' ? n : n + (x.direction === 'in' ? x.amountPaise : -x.amountPaise)), 0);
                        return (
                            <View key={g.day}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 }}>
                                    <Text style={{ flex: 1, color: muted, fontWeight: '800', fontSize: 12.5 }}>{dayLabel(g.day).toUpperCase()}</Text>
                                    <Text style={{ color: muted, fontWeight: '700', fontSize: 12.5 }}>{net >= 0 ? '+' : '−'}{rupees(Math.abs(net))}</Text>
                                </View>
                                <Card style={{ paddingVertical: 2 }}>
                                    {g.rows.map((x, i) => {
                                        const k = KIND[x.category] || { icon: 'cash' };
                                        const inn = x.direction === 'in';
                                        return (
                                            <Pressable key={x.id} onPress={() => setOpen(x)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: i ? 0.5 : 0, borderTopColor: border, opacity: pressed ? 0.6 : 1 })}>
                                                <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(inn ? ok : muted, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                                                    <Ionicons name={k.icon} size={20} color={inn ? ok : muted} />
                                                </View>
                                                <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                                    <Text style={{ color: text, fontWeight: '800', fontSize: 14.5 }} numberOfLines={1}>{tr(x.label)}</Text>
                                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{subtitle(x)}</Text>
                                                </View>
                                                <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                                                    <Text style={{ color: x.status === 'pending' ? muted : inn ? ok : text, fontWeight: '900', fontSize: 15 }}>{inn ? '+' : '−'}{rupees(x.amountPaise)}</Text>
                                                    <Text style={{ color: muted, fontSize: 11.5, marginTop: 1 }}>{timeOf(x.at)}{x.howLabel ? ` · ${tr(x.howLabel)}` : ''}{x.status === 'pending' ? ` · ${tr('to pay')}` : ''}</Text>
                                                </View>
                                            </Pressable>
                                        );
                                    })}
                                </Card>
                            </View>
                        );
                    })}
                    {more ? <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label={tr('Show more')} kind="ghost" onPress={() => load(page + 1, true)} /></View> : null}
                    {items.length ? <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label={tr('Excel Sheet')} icon="download" kind="ghost" working={busy} disabled={busy} onPress={csv} /></View> : null}
                </>
            ) : null}

            <CalendarSheet visible={sheet === 'day'} mode="day" onClose={() => setSheet('')} onPick={(v) => picked('day', v)} />
            <CalendarSheet visible={sheet === 'range'} mode="range" onClose={() => setSheet('')} onPick={(v) => picked('range', v)} />
            <MonthSheet visible={sheet === 'month'} onClose={() => setSheet('')} onPick={(v) => picked('monthpick', v)} />
            <Detail x={open} onClose={() => setOpen(null)} onOpenOrder={(id) => { setOpen(null); nav.navigate('OwnerOrder', { id: String(id) }); }} />
        </OwnerScreen>
    );
}
