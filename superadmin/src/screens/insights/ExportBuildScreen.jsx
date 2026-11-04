import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Chip, SectionTitle } from '../../components/ui';
import { Field, SearchBar, Segmented } from '../../components/inputs';
import { Switch } from '../../components/settingsForm';
import { FunnelButton, FilterPopup } from '../../components/FilterPopup';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, SheetScroll, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { useShopsStore } from '../../store/useShopsStore';
import { fetchExportCatalog, countExport, downloadExport, loadPresets, savePresets } from '../../api/exportApi';
import { errMsg } from '../../api/adminClient';

const IST = 330 * 60000;
const ymd = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const PERIODS = [
    { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' },
    { value: 'month', label: 'This month' }, { value: 'lastmonth', label: 'Last month' }, { value: 'year', label: 'This year' }, { value: 'custom', label: 'Pick dates' },
];
const LEVEL_TEXT = {
    quick: 'The few columns you look at every day.',
    standard: 'The working detail: money split, people, times.',
    everything: 'All of it, a plain-words summary of each person (behaviour, habits, what to do), and a second sheet of lines where there is one (dishes, bill lines).',
};

// from / to (India dates) of a period choice
function rangeOf(period, from, to) {
    const now = Date.now();
    if (period === 'today') return { from: ymd(now), to: ymd(now) };
    if (period === '7' || period === '30') return { from: ymd(now - Number(period) * 86400000), to: ymd(now) };
    if (period === 'month') return { from: `${ymd(now).slice(0, 8)}01`, to: ymd(now) };
    if (period === 'lastmonth') {
        const d = new Date(now + IST); d.setUTCDate(1); d.setUTCDate(0);   // the last day of the month before
        const last = d.toISOString().slice(0, 10);
        return { from: `${last.slice(0, 8)}01`, to: last };
    }
    if (period === 'year') return { from: `${ymd(now).slice(0, 4)}-01-01`, to: ymd(now) };
    if (period === 'custom') return { from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined, to: /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : undefined };
    return {};
}

// One export, set up in a minute: which shops, which period, how much detail, the filters of this export. It says how many rows it will hold before you download.
export default function ExportBuildScreen() {
    const t = useTheme();
    const { key, preset } = useRoute().params;
    const shops = useShopsStore((s) => s.items);
    const [cat, setCat] = useState(null);
    const [error, setError] = useState('');
    const [shopIds, setShopIds] = useState(preset?.shopIds || []);
    const [period, setPeriod] = useState(preset?.period || 'all');
    const [from, setFrom] = useState(preset?.from || '');
    const [to, setTo] = useState(preset?.to || '');
    const [level, setLevel] = useState(preset?.level || 'standard');
    const [filters, setFilters] = useState(preset?.filters || {});
    const [format, setFormat] = useState(preset?.format || 'xlsx');
    const [full, setFull] = useState(false);
    const [count, setCount] = useState(null);
    const [busy, setBusy] = useState(false);
    const [picker, setPicker] = useState(false);
    const [shopQ, setShopQ] = useState('');
    const [filterOpen, setFilterOpen] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [showCols, setShowCols] = useState(false);

    useEffect(() => { fetchExportCatalog().then(setCat).catch((e) => setError(errMsg(e))); }, []);
    useEffect(() => { if (!shops.length) useShopsStore.getState().load(); }, [shops.length]);

    const item = cat?.items.find((i) => i.key === key);
    const params = useMemo(() => {
        const r = rangeOf(period, from, to);
        const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
        return { level, ...(shopIds.length ? { shops: shopIds.join(',') } : {}), ...(r.from ? { from: r.from } : {}), ...(r.to ? { to: r.to } : {}), ...f };
    }, [level, shopIds, period, from, to, filters]);

    // how many rows this choice gives, asked again a moment after any change
    useEffect(() => {
        if (!item) return undefined;
        setCount(null);
        const id = setTimeout(() => { countExport(key, params).then(setCount).catch(() => setCount({ error: true })); }, 400);
        return () => clearTimeout(id);
    }, [item, key, params]);

    const activeFilters = Object.values(filters).filter(Boolean).length;
    const toggleShop = (id) => setShopIds((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
    const brands = useMemo(() => {
        const m = new Map();
        for (const s of shops) if (s.brandId) { const k = String(s.brandId); if (!m.has(k)) m.set(k, { id: k, name: s.stats?.brandName || 'Brand', ids: [] }); m.get(k).ids.push(s._id); }
        return [...m.values()];
    }, [shops]);
    const shown = shops.filter((s) => !shopQ.trim() || s.name.toLowerCase().includes(shopQ.trim().toLowerCase()));
    const shopText = !shopIds.length ? 'All shops' : shopIds.length === 1 ? (shops.find((s) => s._id === shopIds[0])?.name || '1 shop') : `${shopIds.length} shops`;

    const go = async () => {
        setBusy(true);
        try { await downloadExport(key, { ...params, format, ...(full ? { full: '1' } : {}) }); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not make the file'), 'error'); } finally { setBusy(false); }
    };
    const saveChoice = async (name) => {
        const list = await loadPresets();
        await savePresets([{ id: String(Date.now()), name: name.slice(0, 40), key, shopIds, period, from, to, level, filters, format }, ...list]);
        toast('Saved. It is on the Export data screen.');
    };

    if (!item) return <Screen title="Export">{error ? <ErrorBox message={error} onRetry={() => fetchExportCatalog().then(setCat)} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const lv = item.levels[level];

    return (
        <Screen title={item.title} subtitle={item.hint} footer={<Button title={busy ? 'Making the file...' : `Download ${format === 'csv' ? 'CSV' : 'Excel'}`} icon="copy" onPress={go} loading={busy} disabled={count?.count === 0} />}>
            {item.shops ? (
                <>
                    <SectionTitle section="shops">Which shops</SectionTitle>
                    <Card onPress={() => setPicker(true)}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name="shops" size={20} color={t.primary} />
                            <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md, marginLeft: spacing.sm }}>{shopText}</Text>
                            <Icon name="next" size={16} color={t.muted} />
                        </View>
                    </Card>
                </>
            ) : null}

            {item.period ? (
                <>
                    <SectionTitle section="platform">{item.periodLabel}</SectionTitle>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        {PERIODS.map((p) => <Chip key={p.value} label={p.label} active={period === p.value} onPress={() => setPeriod(p.value)} />)}
                    </View>
                    {period === 'custom' ? (
                        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                            <View style={{ flex: 1 }}><Field label="From" placeholder="2026-11-01" value={from} onChangeText={setFrom} maxLength={10} keyboardType="numbers-and-punctuation" /></View>
                            <View style={{ flex: 1 }}><Field label="To" placeholder="2026-11-30" value={to} onChangeText={setTo} maxLength={10} keyboardType="numbers-and-punctuation" /></View>
                        </View>
                    ) : null}
                </>
            ) : null}

            <SectionTitle section="catalog">How much detail</SectionTitle>
            {['quick', 'standard', 'everything'].map((n) => {
                const l = item.levels[n];
                const on = level === n;
                return (
                    <Pressable key={n} onPress={() => setLevel(n)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: on ? t.primary : t.border, backgroundColor: t.surface }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ flex: 1, color: on ? t.primary : t.text, fontWeight: '800', fontSize: font.md }}>{l.label} · {l.columns.length} columns{l.extra ? ' + dish sheet' : ''}</Text>
                            {on ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </View>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{LEVEL_TEXT[n]}</Text>
                    </Pressable>
                );
            })}
            <Pressable onPress={() => setShowCols((v) => !v)} hitSlop={8}><Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginBottom: spacing.sm }}>{showCols ? 'Hide the columns' : `See the ${lv.columns.length} columns`}</Text></Pressable>
            {showCols ? <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>{lv.columns.join(' · ')}</Text> : null}

            {item.filters.length ? (
                <>
                    <SectionTitle section="settings">Filters</SectionTitle>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: activeFilters ? t.primary : t.muted, fontWeight: '700', fontSize: font.sm }} numberOfLines={2}>
                            {activeFilters ? item.filters.filter((f) => filters[f.key]).map((f) => `${f.label}: ${(f.options.find((o) => o[0] === filters[f.key]) || [0, filters[f.key]])[1]}`).join(' · ') : 'None: everything matching the shops and period'}
                        </Text>
                        <FunnelButton count={activeFilters} onPress={() => setFilterOpen(true)} />
                    </View>
                </>
            ) : null}

            <SectionTitle section="money">File</SectionTitle>
            <Segmented value={format} onChange={setFormat} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }]} />
            {cat.canSeeFullPhones && ['customers', 'orders', 'riders', 'shops', 'owners', 'brand_people', 'staff'].includes(key) ? (
                <Card style={{ marginTop: spacing.md }}>
                    <Switch title="Full phone numbers" subtitle="Written in the audit log. Leave off unless you need to call them." value={full} onValueChange={setFull} last />
                </Card>
            ) : null}

            <Card style={{ marginTop: spacing.lg }}>
                <Text style={{ color: count?.capped ? t.danger : t.text, fontWeight: '800', fontSize: font.lg }}>
                    {count === null ? 'Counting...' : count.error ? 'Could not count' : `${count.count.toLocaleString('en-IN')} row${count.count === 1 ? '' : 's'}`}
                </Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                    {count?.capped ? `The file holds the first ${count.max.toLocaleString('en-IN')}. Narrow the period or pick fewer shops to get them all.` : count?.count === 0 ? 'Nothing matches. Change the shops, period or filters.' : 'This is what the file will hold.'}
                </Text>
            </Card>
            <Button kind="outline" icon="bolt" title="Save this choice for next time" onPress={() => setSaveOpen(true)} style={{ marginTop: spacing.md }} />

            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shops?">
                <SearchBar value={shopQ} onChangeText={setShopQ} placeholder="Shop name" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <Chip label="All shops" active={!shopIds.length} onPress={() => setShopIds([])} />
                    {brands.map((b) => <Chip key={b.id} label={`${b.name} (all branches)`} icon="shops" active={b.ids.every((x) => shopIds.includes(x)) && shopIds.length === b.ids.length} onPress={() => setShopIds(b.ids)} />)}
                </View>
                <SheetScroll style={{ maxHeight: 320, marginTop: spacing.sm }}>
                    {shown.map((s) => (
                        <Pressable key={s._id} onPress={() => toggleShop(s._id)} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: t.border }}>
                            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{s.name}</Text>
                            {shopIds.includes(s._id) ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </Pressable>
                    ))}
                </SheetScroll>
                <Button title={shopIds.length ? `Use ${shopIds.length} shop${shopIds.length === 1 ? '' : 's'}` : 'Use all shops'} onPress={() => setPicker(false)} style={{ marginTop: spacing.md }} />
            </Sheet>

            <FilterPopup
                visible={filterOpen}
                onClose={() => setFilterOpen(false)}
                title="Filters"
                activeCount={activeFilters}
                onClear={() => setFilters({})}
                sections={item.filters.map((f) => ({ key: f.key, title: f.label, options: [['', 'Any'], ...f.options.filter((o) => o[0] !== '')], value: filters[f.key] || '', onChange: (v) => setFilters((x) => ({ ...x, [f.key]: v })) }))}
            />
            <ConfirmSheet visible={saveOpen} onClose={() => setSaveOpen(false)} icon="bolt" title="Save this choice" message="Name it, for example: Last month orders for my CA." needReason reasonLabel="Name" confirmLabel="Save" onConfirm={saveChoice} />
        </Screen>
    );
}
