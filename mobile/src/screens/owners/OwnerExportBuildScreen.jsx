// One file, set up in a minute: which shops (a brand owner), which period, how much detail, the filters of this file. It says how many rows it will hold before you download.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Hero } from '../../components/owners/RiderDesk';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Option, Chips, Button, Sheet } from '../../components/owners/ui';
import { FunnelButton, FilterPopup } from '../../components/owners/FilterPopup';
import { ListShimmer } from '../../components/owners/shimmer';
import { downloadAndOpen, XLSX } from '../../utils/owners/files';
import { showToast } from '../../components/customers/shop';
import { fetchExportCatalog, countExport, exportDownloadPath, apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

const IST = 330 * 60000;
const ymd = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const PERIODS = [['all', 'All time'], ['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year']];
const LEVEL_TEXT = {
    quick: 'The few columns you look at every day.',
    standard: 'The working detail: money split, people, times.',
    everything: 'All of it, a plain-words summary of each person (habits, what to do), and a second sheet of lines where there is one.',
};
function rangeOf(period) {
    const now = Date.now();
    if (period === 'today') return { from: ymd(now), to: ymd(now) };
    if (period === '7' || period === '30') return { from: ymd(now - Number(period) * 86400000), to: ymd(now) };
    if (period === 'month') return { from: `${ymd(now).slice(0, 8)}01`, to: ymd(now) };
    if (period === 'lastmonth') { const d = new Date(now + IST); d.setUTCDate(1); d.setUTCDate(0); const last = d.toISOString().slice(0, 10); return { from: `${last.slice(0, 8)}01`, to: last }; }
    if (period === 'year') return { from: `${ymd(now).slice(0, 4)}-01-01`, to: ymd(now) };
    return {};
}

export default function OwnerExportBuildScreen() {
    const { key } = useRoute().params;
    const { text, muted, primary, border, error: red } = useBrand();
    const desk = useOwnerDesktop();
    const [cat, setCat] = useState(null);
    const [err, setErr] = useState('');
    const [shopIds, setShopIds] = useState([]);
    const [period, setPeriod] = useState('all');
    const [level, setLevel] = useState('standard');
    const [filters, setFilters] = useState({});
    const [format, setFormat] = useState('xlsx');
    const [count, setCount] = useState(null);
    const [busy, setBusy] = useState(false);
    const [picker, setPicker] = useState(false);
    const [filterOpen, setFilterOpen] = useState(false);
    const [showCols, setShowCols] = useState(false);

    useEffect(() => { fetchExportCatalog().then(setCat).catch((e) => setErr(apiError(e))); }, []);
    const item = cat && cat.items.find((i) => i.key === key);
    const params = useMemo(() => {
        const r = rangeOf(period);
        const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
        return { level, ...(shopIds.length ? { shops: shopIds.join(',') } : {}), ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}), ...f };
    }, [level, shopIds, period, filters]);

    useEffect(() => {
        if (!item) return undefined;
        if (!desk) setCount(null);   // on a computer the old number stays (dimmed) until the new one lands
        const id = setTimeout(() => { countExport(key, { ...params, format }).then(setCount).catch(() => setCount({ error: true })); }, 400);
        return () => clearTimeout(id);
    }, [item, key, params, format, desk]);

    if (!item) return <OwnerScreen title={tr('Download your data')} page>{err ? <Text style={{ color: red, margin: 16 }}>{err}</Text> : <View style={{ padding: 16 }}><ListShimmer /></View>}</OwnerScreen>;

    const activeFilters = Object.values(filters).filter(Boolean).length;
    const lv = item.levels[level];
    const pickShops = cat.shops.length > 1 && item.shops;
    const shopText = !shopIds.length ? tr('All my shops') : shopIds.length === 1 ? ((cat.shops.find((s) => s.id === shopIds[0]) || {}).name || '1') : `${shopIds.length} ${tr('shops')}`;
    const toggle = (id) => setShopIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

    const go = async () => {
        setBusy(true);
        try {
            await downloadAndOpen({ path: exportDownloadPath(key), params: { ...params, format }, filename: `${key}-${Date.now()}.${format}`, mime: format === 'csv' ? 'text/csv' : XLSX, title: tr(item.title) });
        } catch (e) { showToast(e && e.safe ? e.message : apiError(e)); } finally { setBusy(false); }
    };

    const summary = (
        <>
                {desk ? null : <SectionTitle title={tr('File')} />}
                <Chips options={[['xlsx', 'Excel'], ['csv', 'CSV']]} value={format} onChange={setFormat} />

                <Card style={{ marginTop: desk ? 0 : 16, opacity: desk && count === null ? 0.55 : 1, transitionProperty: 'opacity', transitionDuration: '160ms' }}>
                    <Text style={{ color: count && count.capped ? red : text, fontWeight: '800', fontSize: 18 }}>
                        {count === null ? tr('Counting...') : count.error ? tr('Could not count') : `${count.count.toLocaleString('en-IN')} ${tr(count.count === 1 ? 'row' : 'rows')}`}
                    </Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>
                        {count && count.capped ? tr('The file holds the first {n}. Pick a shorter period to get them all.', { n: count.max.toLocaleString('en-IN') }) + (format === 'xlsx' ? ' ' + tr('Or choose CSV: it holds more.') : '') : count && count.count === 0 ? tr('Nothing matches. Change the period or the filters.') : tr('This is what the file will hold.')}
                    </Text>
                </Card>
                <Button label={busy ? tr('Making the file...') : tr(format === 'csv' ? 'Download CSV' : 'Download Excel')} icon="download" onPress={go} busy={busy} disabled={count && count.count === 0} style={{ marginTop: 16 }} />
        </>
    );

    return (
        <OwnerScreen title={tr(item.title)} page wide={desk}>
            {desk ? <Hero icon="download" title={tr(item.title)} subtitle={tr(item.hint)} /> : null}
            <View style={{ padding: 16 }}>
              <View style={desk ? { flexDirection: 'row', alignItems: 'flex-start' } : undefined}>
              <View style={desk ? { flex: 1, minWidth: 0, marginRight: 24 } : undefined}>
                {desk ? null : <Text style={{ color: muted, fontSize: 13 }}>{tr(item.hint)}</Text>}

                {pickShops ? (
                    <>
                        <SectionTitle title={tr('Which shops')} />
                        <Card onPress={() => setPicker(true)}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="storefront" size={20} color={primary} />
                                <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15, marginLeft: 10 }}>{shopText}</Text>
                                <Ionicons name="chevron-forward" size={18} color={muted} />
                            </View>
                        </Card>
                    </>
                ) : null}

                {item.period ? (
                    <>
                        <SectionTitle title={tr(item.periodLabel || 'Period')} />
                        <Chips options={PERIODS.map(([v, l]) => [v, tr(l)])} value={period} onChange={setPeriod} />
                    </>
                ) : null}

                <SectionTitle title={tr('How much detail')} />
                <Card style={{ paddingHorizontal: 12 }}>
                    {['quick', 'standard', 'everything'].map((n, i) => (
                        <Option key={n} selected={level === n} title={`${tr(item.levels[n].label)} · ${item.levels[n].columns.length} ${tr('columns')}`} subtitle={tr(LEVEL_TEXT[n])} onPress={() => setLevel(n)} last={i === 2} />
                    ))}
                </Card>
                <Pressable onPress={() => setShowCols((v) => !v)} hitSlop={8} style={{ marginTop: 8 }}><Text style={{ color: primary, fontWeight: '700', fontSize: 13 }}>{showCols ? tr('Hide the columns') : `${tr('See the columns')} (${lv.columns.length})`}</Text></Pressable>
                {showCols ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{lv.columns.join(' · ')}</Text> : null}

                {item.filters.length ? (
                    <>
                        <SectionTitle title={tr('Filters')} />
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ flex: 1, color: activeFilters ? primary : muted, fontWeight: '700', fontSize: 13, paddingRight: 8 }} numberOfLines={2}>
                                {activeFilters ? item.filters.filter((f) => filters[f.key]).map((f) => `${tr(f.label)}: ${tr((f.options.find((o) => o[0] === filters[f.key]) || [0, filters[f.key]])[1])}`).join(' · ') : tr('None: everything that matches')}
                            </Text>
                            <FunnelButton count={activeFilters} onPress={() => setFilterOpen(true)} />
                        </View>
                    </>
                ) : null}

                {desk ? null : summary}
              </View>
              {desk ? <View style={{ width: 380 }}><SectionTitle title={tr('File')} />{summary}</View> : null}
              </View>
            </View>

            <Sheet visible={picker} onClose={() => setPicker(false)} title={tr('Which shops?')}>
                <ScrollView style={{ maxHeight: 360 }}>
                    <Pressable onPress={() => setShopIds([])} style={{ paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15 }}>{tr('All my shops')}</Text>
                        {!shopIds.length ? <Ionicons name="checkmark-circle" size={22} color={primary} /> : null}
                    </Pressable>
                    {cat.shops.map((s) => (
                        <Pressable key={s.id} onPress={() => toggle(s.id)} style={({ hovered }) => ({ paddingVertical: 12, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: hovered ? 'transparent' : border, ...(hovered ? { backgroundColor: 'rgba(128,128,128,0.1)', borderRadius: 14, marginHorizontal: -10, paddingHorizontal: 10, cursor: 'pointer' } : null) })}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>{s.name}</Text>
                                {s.city ? <Text style={{ color: muted, fontSize: 12 }}>{s.city}</Text> : null}
                            </View>
                            {shopIds.includes(s.id) ? <Ionicons name="checkmark-circle" size={22} color={primary} /> : null}
                        </Pressable>
                    ))}
                </ScrollView>
                <Button label={shopIds.length ? `${tr('Use')} ${shopIds.length}` : tr('Use all shops')} onPress={() => setPicker(false)} style={{ marginTop: 12 }} />
            </Sheet>

            <FilterPopup
                visible={filterOpen}
                onClose={() => setFilterOpen(false)}
                title={tr('Filters')}
                activeCount={activeFilters}
                onClear={() => setFilters({})}
                sections={item.filters.map((f) => ({ key: f.key, title: f.label, options: [['', 'Any'], ...f.options.filter((o) => o[0] !== '')], value: filters[f.key] || '', onChange: (v) => setFilters((x) => ({ ...x, [f.key]: v })) }))}
            />
        </OwnerScreen>
    );
}
