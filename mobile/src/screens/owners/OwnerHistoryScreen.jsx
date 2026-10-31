// History: every order of the shop in one list. A search box (customer, order number, dish, phone, address), the funnel (time, status, type, payment),
// a summary of what is on screen, a total for every day, and an Excel file of the same list. Tap an order for everything about it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, RefreshControl, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, Empty } from '../../components/owners/ui';
import { CalendarSheet } from '../../components/owners/CalendarSheet';
import { FunnelButton, FilterPopup } from '../../components/owners/FilterPopup';
import { ListShimmer, LineShimmer } from '../../components/owners/shimmer';
import { callPhone, whatsApp, openInvoice } from '../../components/owners/orderBits';
import { orderHistory, orderHistoryExportPath, apiError } from '../../api/owners/shopApi';
import { downloadAndOpen, XLSX } from '../../utils/owners/files';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ease } from '../../utils/common/ease';
import { tr } from '../../i18n';

const rs = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const STATUS = { placed: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', undelivered: 'Not delivered' };
const TYPE = { delivery: ['bicycle', 'Delivery'], pickup: ['walk', 'Pickup'], dine_in: ['restaurant', 'Dine in'] };
const FLAG = { cancelled: 'Cancelled', undelivered: 'Not delivered', refunded: 'Refunded', late: 'Late', kitchen: 'Kitchen problem', rider_problem: 'Rider problem', complaint: 'Complaint' };
const WHO = { customer: 'customer', shop: 'you', rider: 'rider', admin: 'platform', system: 'system' };
const RANGE_LABEL = { '24h': 'Last 24 hours', week: 'Last week', month: 'Last month' };
const istDay = (d) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10);
const dayName = (ymd) => {
    const t = istDay(Date.now());
    if (ymd === t) return tr('Today');
    if (ymd === istDay(Date.now() - 86400000)) return tr('Yesterday');
    return new Date(`${ymd}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
};
const clock = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Tag({ label, color, icon }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: alpha(color, 0.13), marginRight: 6, marginBottom: 6 }}>
            {icon ? <Ionicons name={icon} size={12} color={color} style={{ marginRight: 4 }} /> : null}
            <Text style={{ color, fontSize: 11.5, fontWeight: '800' }}>{label}</Text>
        </View>
    );
}

function Round({ icon, onPress, label, busy }) {
    const { primary, border, surface } = useBrand();
    return (
        <Pressable onPress={onPress} disabled={busy} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}
            style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
            {busy ? <ActivityIndicator size="small" color={primary} /> : <Ionicons name={icon} size={19} color={primary} />}
        </Pressable>
    );
}

function OrderCard({ o, onOpen, onCustomer }) {
    const { text, muted, primary, ok, error, warn } = useBrand();
    const [inv, setInv] = useState(false);
    const gone = o.status === 'cancelled' || o.status === 'undelivered';
    const tone = o.status === 'delivered' ? ok : gone ? error : primary;
    const [ticon, tlabel] = TYPE[o.orderType] || ['receipt', o.orderType];
    const cash = o.payment.method === 'cod';
    return (
        <Card onPress={onOpen} style={{ opacity: gone ? 0.82 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>#{o.orderNo}</Text>
                <Text style={{ color: muted, fontSize: 12.5, marginLeft: 8, flex: 1 }}>{clock(o.createdAt)}</Text>
                <Tag label={tr(STATUS[o.status] || o.status)} color={tone} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 }}>
                <Pressable onPress={onCustomer} disabled={!o.customer.phone} style={{ flex: 1, paddingRight: 8 }}>
                    <Text numberOfLines={1} style={{ color: text, fontWeight: '800', fontSize: 15 }}>{o.customer.name || tr('Customer')}</Text>
                    {o.customer.phone ? <Text style={{ color: muted, fontSize: 12.5 }}>{o.customer.phone}{o.orders > 1 ? `  ·  ${tr('{n} orders', { n: o.orders })}` : ''}</Text> : null}
                </Pressable>
                <Text style={{ color: gone ? muted : text, fontWeight: '900', fontSize: 18, textDecorationLine: gone ? 'line-through' : 'none' }}>{rs(o.total)}</Text>
            </View>
            {o.dishes ? <Text numberOfLines={2} style={{ color: muted, marginTop: 6, fontSize: 13.5 }}>{o.dishes}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                <Tag label={tr(tlabel)} color={primary} icon={ticon} />
                <Tag label={cash ? tr('Cash') : tr('Online')} color={cash ? warn : ok} icon={cash ? 'cash-outline' : 'card-outline'} />
                {o.orders > 1 ? <Tag label={tr('Repeat customer')} color={ok} icon="repeat" /> : null}
                {o.couponCode ? <Tag label={o.couponCode} color={muted} icon="pricetag-outline" /> : null}
                {o.flags.map((f) => <Tag key={f.k} label={`${tr(FLAG[f.k] || f.k)}${f.by && WHO[f.by] ? ` · ${tr(WHO[f.by])}` : ''}`} color={error} icon="alert-circle" />)}
            </View>
            {o.table ? <Text style={{ color: muted, fontSize: 12.5 }}>{tr('Table {t}', { t: o.table })}</Text> : o.address ? <Text numberOfLines={1} style={{ color: muted, fontSize: 12.5 }}><Ionicons name="location-outline" size={12} color={muted} /> {o.address}</Text> : null}
            {o.rider ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Rider')}: {o.rider}</Text> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                {o.customer.phone ? <Round icon="call" label={tr('Call')} onPress={() => callPhone(o.customer.phone)} /> : null}
                {o.customer.phone ? <Round icon="logo-whatsapp" label="WhatsApp" onPress={() => whatsApp(o.customer.phone)} /> : null}
                {o.status === 'delivered' ? <Round icon="document-text-outline" label={tr('Invoice (PDF)')} busy={inv} onPress={() => openInvoice({ id: o._id, orderNo: o.orderNo }, setInv)} /> : null}
            </View>
        </Card>
    );
}

export default function OwnerHistoryScreen() {
    const nav = useNavigation();
    const { text, muted, primary, border, surface, ok, error } = useBrand();
    const [input, setInput] = useState('');
    const [q, setQ] = useState('');
    const [range, setRange] = useState('24h');            // 24h | week | month | custom
    const [dates, setDates] = useState(null);             // { from, to } for custom
    const [status, setStatus] = useState('');
    const [type, setType] = useState('');
    const [pay, setPay] = useState('');
    const [data, setData] = useState(null);               // { items, hasMore, page, summary, byDay }
    const [more, setMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [sheet, setSheet] = useState('');               // '' | filter | day | range
    const [file, setFile] = useState(false);
    const req = useRef(0);

    useEffect(() => { const t = setTimeout(() => setQ(input.trim()), 350); return () => clearTimeout(t); }, [input]);   // search a moment after he stops typing

    const params = useMemo(() => ({ range, ...(range === 'custom' && dates ? { from: dates.from, to: dates.to } : {}), ...(q ? { q } : {}), ...(status ? { status } : {}), ...(type ? { type } : {}), ...(pay ? { pay } : {}) }), [range, dates, q, status, type, pay]);
    const load = useCallback(async (quiet) => {
        const id = ++req.current;
        try {
            const r = await orderHistory({ ...params, page: 1 });
            if (id !== req.current) return;
            ease(); setData(r);
        } catch (e) {
            if (id !== req.current) return;
            useOwnerStore.getState().noteError(e);
            if (!quiet) showToast(apiError(e));
            setData((x) => x || { items: [], hasMore: false, page: 1, summary: null, byDay: {} });
        }
    }, [params]);
    useEffect(() => { setData(null); load(); }, [load]);
    const refresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };
    const loadMore = async () => {
        if (!data?.hasMore || more) return;
        setMore(true);
        const id = req.current;
        try {
            const r = await orderHistory({ ...params, page: data.page + 1 });
            if (id === req.current) setData((x) => ({ ...x, items: [...x.items, ...r.items], hasMore: r.hasMore, page: r.page }));
        } catch (e) { showToast(apiError(e)); } finally { setMore(false); }
    };

    const active = (range !== '24h' ? 1 : 0) + (status ? 1 : 0) + (type ? 1 : 0) + (pay ? 1 : 0);
    const clearAll = () => { ease(); setRange('24h'); setDates(null); setStatus(''); setType(''); setPay(''); };
    const timeLabel = range === 'custom' && dates ? (dates.from === dates.to ? dates.from : `${dates.from} → ${dates.to}`) : tr(RANGE_LABEL[range] || RANGE_LABEL['24h']);

    // the list: a heading for each day (with that day's total from the server), then its orders
    const rows = useMemo(() => {
        const out = []; let last = '';
        for (const o of data?.items || []) {
            const day = istDay(o.createdAt);
            if (day !== last) { out.push({ k: `d${day}`, head: day }); last = day; }
            out.push({ k: o._id, o });
        }
        return out;
    }, [data]);

    const download = async () => {
        if (file) return;
        setFile(true);
        try { await downloadAndOpen({ path: orderHistoryExportPath, params, filename: 'order-history.xlsx', mime: XLSX, title: tr('Order history') }); }
        catch (e) { showToast(e?.safe ? e.message : apiError(e)); } finally { setFile(false); }
    };

    const sm = data?.summary;
    const header = (
        <View>
            {active ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingTop: 2 }}>
                    {range !== '24h' ? <Chip label={timeLabel} onClear={() => { ease(); setRange('24h'); setDates(null); }} /> : null}
                    {status ? <Chip label={tr({ delivered: 'Delivered', cancelled: 'Cancelled', progress: 'In progress' }[status])} onClear={() => { ease(); setStatus(''); }} /> : null}
                    {type ? <Chip label={tr(TYPE[type][1])} onClear={() => { ease(); setType(''); }} /> : null}
                    {pay ? <Chip label={tr({ cash: 'Cash', online: 'Online', unpaid: 'Unpaid' }[pay])} onClear={() => { ease(); setPay(''); }} /> : null}
                </View>
            ) : null}
            <Card>
                {!sm ? <View><LineShimmer width={160} height={22} /><View style={{ height: 8 }} /><LineShimmer width={240} height={14} /></View> : (
                    <>
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{timeLabel}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                            <Figure label={tr('Orders')} value={String(sm.orders)} />
                            <Figure label={tr('Sales')} value={rs(sm.sales)} color={primary} />
                            <Figure label={tr('Average')} value={rs(sm.average)} />
                        </View>
                        <View style={{ height: 1, backgroundColor: border, marginVertical: 10 }} />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            <Figure label={tr('Cash')} value={rs(sm.cash)} small />
                            <Figure label={tr('Online')} value={rs(sm.online)} small />
                            <Figure label={tr('Cancelled')} value={`${sm.cancelled} · ${rs(sm.lost)}`} color={sm.cancelled ? error : undefined} small />
                        </View>
                    </>
                )}
            </Card>
        </View>
    );

    return (
        <OwnerScreen title={tr('History')} scroll={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 }}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 14, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 12 }}>
                    <Ionicons name="search" size={18} color={muted} />
                    <TextInput value={input} onChangeText={setInput} placeholder={tr('Name, order no, dish, phone, address')} placeholderTextColor={muted} autoCorrect={false}
                        style={{ flex: 1, color: text, fontSize: 14.5, paddingHorizontal: 8, paddingVertical: 0 }} returnKeyType="search" />
                    {input ? <Pressable onPress={() => setInput('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={muted} /></Pressable> : null}
                </View>
                <View style={{ width: 10 }} />
                <FunnelButton count={active} onPress={() => setSheet('filter')} />
                <Pressable onPress={download} disabled={file} accessibilityRole="button" accessibilityLabel={tr('Excel')} hitSlop={6}
                    style={{ height: 46, width: 46, borderRadius: 14, marginLeft: 10, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', opacity: file ? 0.6 : 1 }}>
                    {file ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={22} color="#fff" />}
                </Pressable>
            </View>

            <FlatList
                data={data ? rows : []}
                keyExtractor={(r) => r.k}
                ListHeaderComponent={header}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
                onEndReached={loadMore}
                onEndReachedThreshold={0.6}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 110 }}
                ListEmptyComponent={data === null ? <ListShimmer count={4} /> : <Empty icon="receipt-outline" title={tr('No orders found')} hint={q || active ? tr('Try another word or clear the filters.') : tr('Orders will show here.')} />}
                ListFooterComponent={more ? <ListShimmer count={1} /> : null}
                renderItem={({ item }) => item.head ? (
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 2 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{dayName(item.head)}</Text>
                        {data.byDay?.[item.head] ? <Text style={{ color: muted, fontSize: 12.5, marginLeft: 8, flex: 1 }}>{tr('{n} orders', { n: data.byDay[item.head].orders })} · {rs(data.byDay[item.head].sales)}</Text> : null}
                    </View>
                ) : <OrderCard o={item.o} onOpen={() => nav.navigate('OwnerOrder', { id: item.o._id })} onCustomer={() => { ease(); setRange('month'); setDates(null); setInput(item.o.customer.phone); }} />}
            />

            <FilterPopup
                visible={sheet === 'filter'} onClose={() => setSheet('')} title={tr('Filter orders')} activeCount={active} onClear={clearAll}
                sections={[
                    { key: 'time', title: tr('Time'), options: [['24h', 'Last 24 hours'], ['week', 'Last week'], ['month', 'Last month'], ['day', 'Pick a date'], ['range', 'Pick dates']], value: range === 'custom' ? '' : range,
                        onChange: (v) => { if (v === 'day' || v === 'range') { setSheet(v); return; } setRange(v); setDates(null); } },
                    { key: 'status', title: tr('Status'), options: [['', 'All'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['progress', 'In progress']], value: status, onChange: setStatus },
                    { key: 'type', title: tr('Type'), options: [['', 'All'], ['delivery', 'Delivery'], ['pickup', 'Pickup'], ['dine_in', 'Dine in']], value: type, onChange: setType },
                    { key: 'pay', title: tr('Payment'), options: [['', 'All'], ['cash', 'Cash'], ['online', 'Online'], ['unpaid', 'Unpaid']], value: pay, onChange: setPay },
                ]}
            />
            <CalendarSheet visible={sheet === 'day'} mode="day" title={tr('Pick a date')} onClose={() => setSheet('')} onPick={(v) => { setRange('custom'); setDates({ from: v.date, to: v.date }); }} />
            <CalendarSheet visible={sheet === 'range'} mode="range" title={tr('Pick dates')} onClose={() => setSheet('')} onPick={(v) => { setRange('custom'); setDates({ from: v.from, to: v.to }); }} />
        </OwnerScreen>
    );
}

function Chip({ label, onClear }) {
    const { primary } = useBrand();
    return (
        <Pressable onPress={onClear} style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 8, paddingVertical: 6, borderRadius: 16, backgroundColor: alpha(primary, 0.12), marginRight: 8, marginBottom: 6 }}>
            <Text style={{ color: primary, fontWeight: '800', fontSize: 12.5 }}>{label}</Text>
            <Ionicons name="close" size={14} color={primary} style={{ marginLeft: 4 }} />
        </Pressable>
    );
}

function Figure({ label, value, color, small }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ minWidth: small ? 96 : 100, flexGrow: 1, flexBasis: small ? '30%' : '28%', marginBottom: 4 }}>
            <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700' }}>{label}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: color || text, fontSize: small ? 15 : 20, fontWeight: '900', marginTop: 1 }}>{value}</Text>
        </View>
    );
}
