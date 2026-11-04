import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Share } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, KeyValue, Stat, Badge, Chip, Button } from '../../components/ui';
import { FunnelButton, FilterPopup } from '../../components/FilterPopup';
import { Sheet, SheetScroll, toast } from '../../components/feedback';
import { shareSalesReportExcel } from '../../api/insightsApi';
import Icon from '../../components/Icon';
import { useShopsStore } from '../../store/useShopsStore';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import BarChart from '../../components/charts';
import { fetchSalesReport, fetchLostSales, fetchIncome, fetchPatterns } from '../../api/ordersApi';
import { errMsg } from '../../api/adminClient';
import { rupees, titleCase, paise } from '../../utils/format';

// "up 12% on before" / "down 5% on before" / "new" (nothing before)
const vs = (pct, had) => (pct === null || pct === undefined ? (had ? '' : 'Nothing before to compare') : pct === 0 ? 'Same as before' : (pct > 0 ? 'Up ' : 'Down ') + Math.abs(pct) + '% on before');
const TREND = { growing: ['Growing', 'success'], falling: ['Falling', 'danger'], quiet: ['Gone quiet', 'warn'], new: ['New', 'info'] };
const SHOP_SORTS = [['sales', 'Most sales'], ['orders', 'Most orders'], ['growth', 'Growing most'], ['falling', 'Falling most']];
const WHO = { shop: 'The shop cancelled', customer: 'The customer cancelled', rider: 'The rider cancelled', admin: 'You cancelled', system: 'The system cancelled', unknown: 'Cancelled', nohome_customer: 'Customer not at home', nohome_shop: 'Shop fault, not delivered', nohome_rider: 'Rider fault, not delivered', nohome_unknown: 'Not delivered' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourName = (h) => (h === null || h === undefined ? '' : (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' am' : ' pm'));
const TYPE_NAME = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine-in' };
const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const RANGES = [
    { value: 'today', label: 'Today' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: 'month', label: 'This month' },
    { value: 'last', label: 'Last month' },
];

function rangeOf(v) {
    const now = new Date();
    if (v === 'today') return { from: ymd(now), to: ymd(now), groupBy: 'day' };
    if (v === '7' || v === '30') return { from: ymd(new Date(now.getTime() - (Number(v) - 1) * 86400000)), to: ymd(now), groupBy: 'day' };
    const ist = new Date(now.getTime() + IST);
    const y = ist.getUTCFullYear();
    const m = ist.getUTCMonth();
    if (v === 'month') return { from: ymd(new Date(Date.UTC(y, m, 1) - IST)), to: ymd(now), groupBy: 'day' };
    return { from: ymd(new Date(Date.UTC(y, m - 1, 1) - IST)), to: ymd(new Date(Date.UTC(y, m, 0) - IST)), groupBy: 'day' };
}

const short = (period) => { const [, mo, d] = period.split('-'); return d ? `${d}/${mo}` : period; };

// Sales = delivered orders, counted on the day they were delivered (the same rule as the backend report).
export default function SalesReportScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const fromRoute = useRoute().params || {};
    const shops = useShopsStore((st) => st.items);
    const [shop, setShop] = useState({ id: fromRoute.shopId || '', name: fromRoute.name || '' });   // one shop, or all shops when id is empty
    const [filters, setFilters] = useState(false);
    const [shopSort, setShopSort] = useState('sales');
    const [lost, setLost] = useState(null);
    const [income, setIncome] = useState(null);
    const [pat, setPat] = useState(null);
    const [busy, setBusy] = useState(false);
    const [picker, setPicker] = useState(false);
    const shopId = shop.id;
    const name = shop.name;
    useEffect(() => { if (!shops.length) useShopsStore.getState().load(); }, [shops.length]);
    const [range, setRange] = useState('30');
    const [r, setR] = useState(null);
    const [error, setError] = useState('');
    const [table, setTable] = useState(false);

    const query = useMemo(() => ({ ...rangeOf(range), ...(shopId ? { tenantId: shopId } : {}) }), [range, shopId]);

    useEffect(() => {
        let alive = true;
        setR(null); setError('');
        fetchSalesReport(query).then((x) => alive && setR(x)).catch((e) => alive && setError(errMsg(e)));
        setLost(null); setPat(null);
        fetchPatterns(query).then((x) => alive && setPat(x)).catch(() => { /* the rest of the report still shows */ });
        fetchLostSales(query).then((x) => alive && setLost(x)).catch(() => { /* the rest of the report still shows */ });
        return () => { alive = false; };
    }, [query]);
    useEffect(() => { fetchIncome().then(setIncome).catch(() => { /* optional block */ }); }, []);

    const sortedShops = [...(r?.shops || [])].sort((x, y) => ({ sales: y.revenue - x.revenue, orders: y.orders - x.orders, growth: (y.changePct ?? -1e9) - (x.changePct ?? -1e9), falling: (x.changePct ?? 1e9) - (y.changePct ?? 1e9) })[shopSort]);
    const downloadExcel = async () => {
        setBusy(true);
        try { await shareSalesReportExcel(query); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not prepare the file'), 'error'); } finally { setBusy(false); }
    };
    // a short text for WhatsApp: the numbers a shop owner or a partner wants at a glance
    const shareSummary = async () => {
        if (!r) return;
        const best = [...(r.shops || [])].sort((x, y) => y.revenue - x.revenue)[0];
        const lines = [
            'Sales report · ' + (RANGES.find((x) => x.value === range)?.label || '') + ' · ' + (shopId ? name : 'All shops'),
            'Sales ' + rupees(r.totals.revenue) + (r.previous?.change.revenue != null ? ' (' + vs(r.previous.change.revenue, 1).toLowerCase() + ')' : ''),
            'Orders ' + r.totals.orders + ' · average ' + rupees(r.totals.averageOrderValue),
            lost && lost.lost.count ? 'Lost: ' + lost.lost.count + ' orders, ' + rupees(lost.lost.value) + ' (' + lost.lost.sharePct + '%)' : null,
            pat && pat.peakHour !== null ? 'Busiest around ' + hourName(pat.peakHour) : null,
            !shopId && best ? 'Top shop: ' + best.name + ' ' + rupees(best.revenue) : null,
        ].filter(Boolean);
        try { await Share.share({ message: lines.join('\n') }); } catch (e) { /* closed without sharing */ }
    };
    const series = (r?.series || []).map((s) => ({ label: short(s.period), value: s.revenue, orders: s.orders, period: s.period }));

    return (
        <Screen title="Sales report" subtitle={name || 'All shops'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ flex: 1, color: shopId || range !== '30' ? t.primary : t.muted, fontWeight: '800', fontSize: font.sm }} numberOfLines={1}>
                    {RANGES.find((x) => x.value === range)?.label}{shopId ? ' · ' + name : ' · All shops'}
                </Text>
                <FunnelButton count={(shopId ? 1 : 0) + (range !== '30' ? 1 : 0)} onPress={() => setFilters(true)} />
            </View>
            {r && r.totals.orders > 0 ? (
                <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
                    <View style={{ flex: 1, marginRight: spacing.sm }}><Button title="Excel" icon="receipt" kind="soft" loading={busy} onPress={downloadExcel} /></View>
                    <View style={{ flex: 1 }}><Button title="Share summary" icon="next" kind="soft" onPress={shareSummary} /></View>
                </View>
            ) : null}
            <FilterPopup
                visible={filters}
                onClose={() => setFilters(false)}
                title="Filter the report"
                activeCount={(shopId ? 1 : 0) + (range !== '30' ? 1 : 0)}
                onClear={() => { setRange('30'); setShop({ id: '', name: '' }); }}
                sections={[
                    { key: 'range', title: 'Period', options: RANGES.map((x) => [x.value, x.label]), value: range, onChange: setRange },
                    { key: 'shop', title: 'Shop', row: shopId ? name : 'All shops', active: !!shopId, onPress: () => { setFilters(false); setTimeout(() => setPicker(true), 250); } },
                ]}
            />
            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shop?">
                <SheetScroll style={{ maxHeight: 380 }}>
                    <Pressable onPress={() => { setShop({ id: '', name: '' }); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }}>All shops</Text>
                        {!shopId ? <Icon name="ok" size={20} color={t.primary} /> : null}
                    </Pressable>
                    {shops.map((x) => (
                        <Pressable key={x._id} onPress={() => { setShop({ id: x._id, name: x.name }); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: t.border }}>
                            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{x.name}</Text>
                            {shopId === x._id ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </Pressable>
                    ))}
                </SheetScroll>
            </Sheet>

            <Card onPress={() => nav.navigate('Customers', shopId ? { shopId, name } : {})} style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="users" size={18} color={t.primary} />
                    <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md, marginLeft: spacing.sm }}>{shopId ? 'Customers of this shop' : 'Customers of every shop'}</Text>
                    <Icon name="next" size={16} color={t.muted} />
                </View>
            </Card>

            {error ? <ErrorBox message={error} onRetry={() => setRange((v) => v)} /> : !r ? <SkeletonDashboard /> : r.totals.orders === 0 ? (
                <Empty icon="chart" title="No sales in this period" hint="Only delivered orders count as sales." />
            ) : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                        <Stat section="money" label="Sales" value={rupees(r.totals.revenue)} icon="rupee" note={vs(r.previous?.change.revenue, r.previous?.totals.revenue)} />
                        <Stat section="orders" label="Orders" value={r.totals.orders} icon="orders" note={vs(r.previous?.change.orders, r.previous?.totals.orders)} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Average order" value={rupees(r.totals.averageOrderValue)} icon="chart" note={vs(r.previous?.change.averageOrderValue, r.previous?.totals.averageOrderValue)} />
                        <Stat label="Not delivered" value={r.undelivered || 0} icon="warning" tone={r.undelivered ? 'warn' : undefined} />
                    </View>

                    <SectionTitle section="money">Sales per day</SectionTitle>
                    <Card>
                        <BarChart data={series} color={t.success} format={(v) => rupees(v)} />
                        <Pressable onPress={() => setTable((v) => !v)} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
                            <Text style={{ color: t.primary, fontWeight: '700' }}>{table ? 'Hide table' : 'Show as table'}</Text>
                        </Pressable>
                        {table ? (
                            <View style={{ marginTop: spacing.sm }}>
                                {series.map((s) => (
                                    <View key={s.period} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 0.5, borderTopColor: t.border }}>
                                        <Text style={{ color: t.muted, flex: 1 }}>{s.period}</Text>
                                        <Text style={{ color: t.muted, width: 70, textAlign: 'right' }}>{s.orders} orders</Text>
                                        <Text style={{ color: t.text, fontWeight: '700', width: 90, textAlign: 'right' }}>{rupees(s.value)}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    </Card>

                    {!shopId && r.shops?.length ? (
                        <>
                            <SectionTitle section="shops">By shop</SectionTitle>
                            <View style={{ height: 48, marginHorizontal: -spacing.lg }}>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                                    {SHOP_SORTS.map(([v, l]) => <Chip key={v} label={l} active={shopSort === v} onPress={() => setShopSort(v)} />)}
                                </ScrollView>
                            </View>
                            <Card style={{ paddingVertical: 0 }}>
                                {sortedShops.map((s, i) => (
                                    <Pressable key={String(s.tenantId)} onPress={() => setShop({ id: String(s.tenantId), name: s.name })} style={{ paddingVertical: spacing.md, borderBottomWidth: i === sortedShops.length - 1 ? 0 : 0.5, borderBottomColor: t.border }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{s.name}</Text>
                                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{rupees(s.revenue)}</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                            <Text style={{ flex: 1, color: t.muted, fontSize: font.xs }}>
                                                {s.orders} orders{s.changePct !== null && s.changePct !== undefined ? ' · ' + (s.changePct > 0 ? 'up ' : s.changePct < 0 ? 'down ' : '') + Math.abs(s.changePct) + '%' : ''}{s.previousRevenue ? ' · before ' + rupees(s.previousRevenue) : ''}
                                            </Text>
                                            {TREND[s.trend] ? <Badge label={TREND[s.trend][0]} tone={TREND[s.trend][1]} /> : null}
                                        </View>
                                    </Pressable>
                                ))}
                            </Card>
                        </>
                    ) : null}

                    {pat ? (
                        <>
                            <SectionTitle section="orders">When people order</SectionTitle>
                            <Card>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>
                                    {pat.peakHour !== null ? 'Busiest around ' + hourName(pat.peakHour) : 'No orders yet'}{pat.busiestDay ? ' · busiest day ' + DAYS[pat.busiestDay - 1] : ''}
                                </Text>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2, marginBottom: spacing.sm }}>Delivered orders by the hour of the day (India time)</Text>
                                <BarChart data={pat.hours.map((h) => ({ label: h.hour % 3 === 0 ? String(h.hour) : '', value: h.orders, orders: h.orders, period: hourName(h.hour) }))} color={t.primary} format={(v) => v + ' orders'} />
                            </Card>
                            <Card style={{ marginTop: spacing.sm }}>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginBottom: spacing.sm }}>By weekday</Text>
                                <BarChart data={pat.days.map((d) => ({ label: DAYS[d.day - 1], value: d.orders, orders: d.orders, period: DAYS[d.day - 1] }))} color={t.info} format={(v) => v + ' orders'} />
                            </Card>
                            {pat.types.length ? (
                                <Card style={{ paddingVertical: 0, marginTop: spacing.sm }}>
                                    {pat.types.map((x, i) => <KeyValue key={x.type} label={(TYPE_NAME[x.type] || titleCase(x.type)) + ' · ' + x.orders + ' orders'} value={rupees(x.revenue)} last={i === pat.types.length - 1} />)}
                                </Card>
                            ) : null}
                            {pat.customers.total ? (
                                <>
                                    <SectionTitle section="people">Customers who ordered</SectionTitle>
                                    <Card>
                                        <View style={{ flexDirection: 'row' }}>
                                            {[['Customers', pat.customers.total], ['New', pat.customers.new], ['Coming back', pat.customers.returning]].map(([l, v]) => (
                                                <View key={l} style={{ flex: 1 }}>
                                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.xl }}>{v}</Text>
                                                    <Text style={{ color: t.muted, fontSize: font.xs }}>{l}</Text>
                                                </View>
                                            ))}
                                        </View>
                                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>
                                            {pat.customers.returningPct}% were already customers before this period{pat.customers.new ? '; ' + pat.customers.newOrderedAgain + ' of the ' + pat.customers.new + ' new ones ordered again' : ''}.
                                        </Text>
                                    </Card>
                                </>
                            ) : null}
                            {pat.cash.paise > 0 ? (
                                <>
                                    <SectionTitle section="alerts">Cash with riders</SectionTitle>
                                    <Card>
                                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg }}>{paise(pat.cash.paise)} still with {pat.cash.riders} rider{pat.cash.riders === 1 ? '' : 's'}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>Cash collected on delivery and not yet handed to the shop.</Text>
                                    </Card>
                                    <Card style={{ paddingVertical: 0, marginTop: spacing.sm }}>
                                        {pat.cash.top.map((x, i) => (
                                            <Pressable key={x.riderId + x.tenantId} onPress={() => nav.navigate('RiderDetail', { shopId: x.tenantId, name: x.shopName, userId: x.riderId })}>
                                                <KeyValue label={x.rider + ' · ' + x.shopName} value={paise(x.paise)} last={i === pat.cash.top.length - 1} />
                                            </Pressable>
                                        ))}
                                    </Card>
                                </>
                            ) : null}
                        </>
                    ) : null}

                    {lost && lost.lost.count > 0 ? (
                        <>
                            <SectionTitle section="alerts">Sales lost</SectionTitle>
                            <Card>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg }}>{rupees(lost.lost.value)} lost on {lost.lost.count} orders</Text>
                                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{lost.lost.sharePct}% of the {lost.orders} orders in this period were cancelled or not delivered.</Text>
                                <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: lost.shopCaused.count ? t.danger : t.text, fontWeight: '800', fontSize: font.md }}>{lost.shopCaused.count}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.xs }}>Caused by shops · {rupees(lost.shopCaused.value)}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{lost.customerCaused.count}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.xs }}>Caused by customers · {rupees(lost.customerCaused.value)}</Text>
                                    </View>
                                </View>
                            </Card>
                            <Card style={{ paddingVertical: 0, marginTop: spacing.sm }}>
                                {lost.byWho.map((w, i) => <KeyValue key={w.key} label={`${WHO[w.key] || titleCase(w.key)} · ${w.count}`} value={rupees(w.value)} last={i === lost.byWho.length - 1} />)}
                            </Card>
                            {lost.shops.length ? (
                                <>
                                    <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700', marginTop: spacing.md, marginBottom: 4 }}>Shops losing the most</Text>
                                    <Card style={{ paddingVertical: 0 }}>
                                        {lost.shops.map((x, i) => (
                                            <Pressable key={x.tenantId} onPress={() => setShop({ id: x.tenantId, name: x.name })}>
                                                <KeyValue label={`${x.name} · ${x.count}`} value={rupees(x.value)} last={i === lost.shops.length - 1} />
                                            </Pressable>
                                        ))}
                                    </Card>
                                </>
                            ) : null}
                            {lost.refunds.count ? (
                                <Card style={{ marginTop: spacing.sm }}>
                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{paise(lost.refunds.paise)} refunded to customers</Text>
                                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{lost.refunds.byReason.map((x) => `${titleCase(String(x.reason).replace(/_/g, ' '))} ${paise(x.paise)}`).join(' · ')}</Text>
                                </Card>
                            ) : null}
                        </>
                    ) : null}

                    {r.topItems?.length ? (
                        <>
                            <SectionTitle section="catalog">Best-selling items</SectionTitle>
                            <Card style={{ paddingVertical: 0 }}>
                                {r.topItems.map((it, i) => (
                                    <KeyValue key={String(it.productId)} label={`${it.name} · ${it.quantity} sold`} value={rupees(it.revenue)} last={i === r.topItems.length - 1} />
                                ))}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="platform">How customers paid</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        {(r.payments || []).map((p, i) => (
                            <KeyValue key={String(p.method)} label={`${{ cod: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet' }[p.method] || titleCase(p.method)} · ${p.orders} orders`} value={rupees(p.revenue)} last={i === r.payments.length - 1} />
                        ))}
                    </Card>

                    <SectionTitle section="platform">Money breakdown</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Items" value={rupees(r.totals.subtotal)} />
                        <KeyValue label="Discounts" value={`− ${rupees(r.totals.discount)}`} />
                        <KeyValue label="Delivery fees" value={rupees(r.totals.deliveryFees)} />
                        <KeyValue label="Packaging" value={rupees(r.totals.packaging)} />
                        <KeyValue label="GST" value={rupees(r.totals.tax)} />
                        <KeyValue label="Tips" value={rupees(r.totals.tips)} last />
                    </Card>
                    {!shopId && income ? (
                        <>
                            <SectionTitle section="money">Your income this month</SectionTitle>
                            <Card style={{ paddingVertical: 0 }}>
                                <KeyValue label="Rent billed" value={paise(income.billedPaise)} />
                                <KeyValue label="Rent collected" value={paise(income.collectedPaise)} />
                                <KeyValue label="SMS margin" value={paise(income.smsMarginPaise)} />
                                <KeyValue label="Costs" value={'− ' + paise(income.costsPaise)} />
                                <KeyValue label={income.netPaise < 0 ? 'Loss' : 'Net'} value={paise(income.netPaise)} last />
                            </Card>
                            <Card onPress={() => nav.navigate('Receivables')} style={{ marginTop: spacing.sm }}>
                                <Text style={{ color: income.overduePaise ? t.danger : t.text, fontWeight: '800', fontSize: font.md }}>{paise(income.owedPaise)} still owed to you</Text>
                                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{income.overduePaise ? paise(income.overduePaise) + ' is overdue from ' + income.overdueShops + ' shop(s). Tap to see who and send a reminder.' : 'Nothing is overdue. Tap to see who owes you.'}</Text>
                            </Card>
                        </>
                    ) : null}
                    <View style={{ marginTop: spacing.md }}><Badge label="Sales = delivered orders, counted on the delivery day" /></View>
                </>
            )}
        </Screen>
    );
}
