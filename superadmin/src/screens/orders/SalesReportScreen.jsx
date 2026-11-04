import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, KeyValue, Stat, Badge } from '../../components/ui';
import { FunnelButton, FilterPopup } from '../../components/FilterPopup';
import { Sheet, SheetScroll } from '../../components/feedback';
import Icon from '../../components/Icon';
import { useShopsStore } from '../../store/useShopsStore';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import BarChart from '../../components/charts';
import { fetchSalesReport } from '../../api/ordersApi';
import { errMsg } from '../../api/adminClient';
import { rupees, titleCase } from '../../utils/format';

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
        return () => { alive = false; };
    }, [query]);

    const series = (r?.series || []).map((s) => ({ label: short(s.period), value: s.revenue, orders: s.orders, period: s.period }));

    return (
        <Screen title="Sales report" subtitle={name || 'All shops'}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ flex: 1, color: shopId || range !== '30' ? t.primary : t.muted, fontWeight: '800', fontSize: font.sm }} numberOfLines={1}>
                    {RANGES.find((x) => x.value === range)?.label}{shopId ? ' · ' + name : ' · All shops'}
                </Text>
                <FunnelButton count={(shopId ? 1 : 0) + (range !== '30' ? 1 : 0)} onPress={() => setFilters(true)} />
            </View>
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
                        <Stat section="money" label="Sales" value={rupees(r.totals.revenue)} icon="rupee" />
                        <Stat section="orders" label="Orders" value={r.totals.orders} icon="orders" />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Average order" value={rupees(r.totals.averageOrderValue)} icon="chart" />
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
                            <Card style={{ paddingVertical: 0 }}>
                                {r.shops.map((s, i) => (
                                    <Pressable key={String(s.tenantId)} onPress={() => setShop({ id: String(s.tenantId), name: s.name })}>
                                        <KeyValue label={`${s.name} · ${s.orders}`} value={rupees(s.revenue)} last={i === r.shops.length - 1} />
                                    </Pressable>
                                ))}
                            </Card>
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
                    <View style={{ marginTop: spacing.md }}><Badge label="Sales = delivered orders, counted on the delivery day" /></View>
                </>
            )}
        </Screen>
    );
}
