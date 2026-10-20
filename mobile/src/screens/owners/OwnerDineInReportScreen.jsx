// The Dine in report: how the tables are doing over the last 7, 30 or 90 days.
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, SectionTitle, Stat, Empty, money } from '../../components/owners/ui';
import { StatShimmer } from '../../components/owners/shimmer';
import { fetchDineReport, apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ap = (h) => (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p');
const OFFER = { welcome: 'Welcome offer', regular: 'Regular customer offer', happy: 'Happy hour', friend: "Friend's offer" };

// a row of bars (hours of the day, days of the week)
function Bars({ values, labels, color, height = 70 }) {
    const { muted } = useBrand();
    const max = Math.max(1, ...values);
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height }}>
                {values.map((n, i) => (
                    <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <View style={{ width: '70%', height: Math.max(n ? 3 : 1, (n / max) * height), borderRadius: 3, backgroundColor: n ? color : alpha(muted, 0.25) }} />
                    </View>
                ))}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 4 }}>
                {values.map((n, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: muted, fontSize: 9 }}>{labels(i)}</Text>)}
            </View>
        </View>
    );
}

export default function OwnerDineInReportScreen() {
    const { background, text, muted, error, ok, primary, warn } = useBrand();
    const [days, setDays] = useState('30');
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        setR(null); setErr('');
        try { setR(await fetchDineReport(Number(days))); } catch (e) { setErr(apiError(e, 'Could not make the report.')); }
    }, [days]);
    useEffect(() => { load(); }, [load]);

    const s = r?.summary;
    const empty = r && !s.orders && !r.unpaid.walkouts;
    const busyHour = r ? r.hours.indexOf(Math.max(...r.hours)) : 0;
    const busyDay = r ? r.weekdays.indexOf(Math.max(...r.weekdays)) : 0;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Dine in report')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 40 }}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['7', tr('7 days')], ['30', tr('30 days')], ['90', tr('90 days')]]} value={days} onChange={setDays} style={{ marginTop: 0 }} />
                </View>
                {!r && !err ? <StatShimmer /> : null}
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {empty ? <Empty icon="restaurant-outline" title={tr('No table orders yet')} hint={tr('When guests order at the tables, this report fills in.')} /> : null}
                {r && !empty ? (
                    <View>
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('Table sales, last {n} days', { n: r.days })}</Text>
                            <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(s.sales)}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                                <Stat label={tr('Visits')} value={String(s.visits)} />
                                <Stat label={tr('Orders')} value={String(s.orders)} />
                                <Stat label={tr('Average bill')} value={money(s.avgBill)} />
                            </View>
                            <View style={{ flexDirection: 'row', marginTop: 14 }}>
                                <Stat label={tr('Guests stay')} value={s.avgStayMin ? tr('{n} min', { n: s.avgStayMin }) : '–'} />
                                <Stat label={tr('Food takes')} value={s.avgWaitMin ? tr('{n} min', { n: s.avgWaitMin }) : '–'} hint={tr('order to served')} />
                                <Stat label={tr('Tips')} value={money(s.tips)} />
                            </View>
                        </Card>

                        <SectionTitle title={tr('When it is busy')} />
                        <Card>
                            <Text style={{ color: muted, fontSize: 12.5, marginBottom: 8 }}>{tr('Busiest hour: {h}. Busiest day: {d}.', { h: ap(busyHour), d: DAYS[busyDay] })}</Text>
                            <Bars values={r.hours} labels={(i) => (i % 3 === 0 ? ap(i) : '')} color={primary} />
                            <View style={{ height: 14 }} />
                            <Bars values={r.weekdays} labels={(i) => DAYS[i]} color={ok} height={50} />
                        </Card>

                        {r.topDishes.length ? (
                            <View>
                                <SectionTitle title={tr('Most ordered at the tables')} />
                                <Card>
                                    {r.topDishes.map((x, i) => (
                                        <View key={x.name} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                            <Text style={{ color: muted, width: 24, fontWeight: '800' }}>{i + 1}</Text>
                                            <Text style={{ color: text, flex: 1, fontWeight: '700' }} numberOfLines={1}>{x.name}</Text>
                                            <Text style={{ color: text, fontWeight: '900' }}>{x.qty}</Text>
                                        </View>
                                    ))}
                                </Card>
                            </View>
                        ) : null}

                        <SectionTitle title={tr('QR codes and tables')} />
                        <Card>
                            <Text style={{ color: muted, fontSize: 12.5, marginBottom: 8 }}>{tr('Scans are guests who scanned the table sticker. A table with no scans may have a missing or unreadable sticker.')}</Text>
                            <View style={{ flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: alpha(muted, 0.25) }}>
                                {['Table', 'Scans', 'Visits', 'Sales'].map((h, i) => <Text key={h} style={{ flex: i === 3 ? 1.4 : 1, color: muted, fontWeight: '800', fontSize: 11.5, textAlign: i ? 'right' : 'left' }}>{tr(h)}</Text>)}
                            </View>
                            {r.tables.map((t) => (
                                <View key={t.table} style={{ flexDirection: 'row', paddingVertical: 5, alignItems: 'center' }}>
                                    <Text style={{ flex: 1, color: text, fontWeight: '900' }}>{t.table}</Text>
                                    <Text style={{ flex: 1, textAlign: 'right', color: t.scans ? text : warn, fontWeight: '800' }}>{t.scans}</Text>
                                    <Text style={{ flex: 1, textAlign: 'right', color: text, fontWeight: '700' }}>{t.visits}</Text>
                                    <Text style={{ flex: 1.4, textAlign: 'right', color: text, fontWeight: '700' }}>{money(t.sales)}</Text>
                                </View>
                            ))}
                            {r.tables.some((t) => !t.scans) ? <Text style={{ color: warn, fontSize: 12.5, fontWeight: '800', marginTop: 8 }}>{tr('Tables with no scans: {list}', { list: r.tables.filter((t) => !t.scans).map((t) => t.table).join(', ') })}</Text> : null}
                        </Card>

                        <SectionTitle title={tr('Guests')} />
                        <Card>
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label={tr('Guests')} value={String(r.guests.total)} />
                                <Stat label={tr('Came back')} value={String(r.guests.repeat)} hint={r.guests.total ? `${Math.round((r.guests.repeat / r.guests.total) * 100)}%` : ''} />
                                <Stat label={tr('Feedback')} value={r.feedback.avg ? `${r.feedback.avg} / 5` : '–'} hint={r.feedback.count ? tr('{n} guests', { n: r.feedback.count }) : ''} />
                            </View>
                            {r.referrals.joined ? (
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 12 }}>{tr('Refer a friend: {a} friends joined, {b} had a first meal, {c} points given.', { a: r.referrals.joined, b: r.referrals.rewarded, c: r.referrals.points })}</Text>
                            ) : null}
                        </Card>

                        {r.offers.length ? (
                            <View>
                                <SectionTitle title={tr('What the offers cost')} />
                                <Card>
                                    {r.offers.map((o) => (
                                        <View key={o.kind} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                            <Text style={{ color: text, flex: 1, fontWeight: '700' }}>{tr(OFFER[o.kind] || o.kind)}</Text>
                                            <Text style={{ color: muted, marginRight: 12 }}>{tr('{n} orders', { n: o.orders })}</Text>
                                            <Text style={{ color: text, fontWeight: '900' }}>{money(o.saved)}</Text>
                                        </View>
                                    ))}
                                </Card>
                            </View>
                        ) : null}

                        <SectionTitle title={tr('Unpaid bills')} />
                        <Card tone={r.unpaid.owedNow > 0 ? error : undefined}>
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label={tr('Walk-outs')} value={String(r.unpaid.walkouts)} />
                                <Stat label={tr('Left unpaid')} value={money(r.unpaid.left)} />
                                <Stat label={tr('Came back')} value={money(r.unpaid.recovered)} color={ok} />
                            </View>
                            <View style={{ flexDirection: 'row', marginTop: 14 }}>
                                <Stat label={tr('Forgiven')} value={money(r.unpaid.forgiven)} />
                                <Stat label={tr('Still owed now')} value={money(r.unpaid.owedNow)} hint={r.unpaid.owedNowCount ? tr('{n} bills', { n: r.unpaid.owedNowCount }) : ''} color={r.unpaid.owedNow > 0 ? error : undefined} />
                                <View style={{ flex: 1 }} />
                            </View>
                            {r.unpaid.repeat.length ? (
                                <View style={{ marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: alpha(muted, 0.25) }}>
                                    <Text style={{ color: text, fontWeight: '900', marginBottom: 4 }}>{tr('Left more than once')}</Text>
                                    {r.unpaid.repeat.map((g, i) => (
                                        <View key={i} style={{ flexDirection: 'row', paddingVertical: 3 }}>
                                            <Text style={{ color: text, flex: 1, fontWeight: '700' }} numberOfLines={1}>{g.name || g.phone || tr('Guest')}</Text>
                                            <Text style={{ color: muted, marginRight: 12 }}>{tr('{n} times', { n: g.times })}</Text>
                                            <Text style={{ color: error, fontWeight: '900' }}>{money(g.amount)}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : null}
                        </Card>
                    </View>
                ) : null}
            </ScrollView>
        </View>
    );
}
