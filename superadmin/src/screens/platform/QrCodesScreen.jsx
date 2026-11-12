import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, ListRow, SectionTitle } from '../../components/ui';
import { SearchBar, ToggleRow, Field } from '../../components/inputs';
import { Choice, Hint } from '../../components/settingsForm';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchQrInfo, fetchDemoPreview, downloadQr } from '../../api/qrApi';
import { fetchShops } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

const FORMATS = [{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG (vector)' }, { value: 'pdf', label: 'PDF (vector)' }];
const PX = [{ value: 1024, label: '1024 px' }, { value: 2048, label: '2048 px' }, { value: 4096, label: '4096 px' }];
const DPI = [{ value: 150, label: '150 DPI' }, { value: 300, label: '300 DPI' }, { value: 600, label: '600 DPI' }];
const MM = [{ value: 50, label: '5 cm' }, { value: 100, label: '10 cm' }, { value: 200, label: '20 cm' }, { value: 400, label: '40 cm' }, { value: 1000, label: '1 m' }];

// Size and file type choices, shared by the demo code and the table codes
function SizeChoices({ v, set }) {
    return (
        <>
            <Choice label="File type" hint="SVG and PDF stay sharp at any size: use them for banners and posters." options={FORMATS} value={v.format} onChange={(x) => set({ ...v, format: x })} />
            {v.format === 'png' ? (
                <>
                    <Choice label="Size" options={PX} value={v.sizePx} onChange={(x) => set({ ...v, sizePx: x })} />
                    <Choice label="Print quality" options={DPI} value={v.dpi} onChange={(x) => set({ ...v, dpi: x })} last />
                </>
            ) : null}
            {v.format === 'pdf' ? <Choice label="Printed size (one code)" options={MM} value={v.sizeMm} onChange={(x) => set({ ...v, sizeMm: x })} last /> : null}
        </>
    );
}
const paramsOf = (v) => ({ format: v.format, ...(v.format === 'png' ? { sizePx: v.sizePx, dpi: v.dpi } : {}), ...(v.format === 'pdf' ? { sizeMm: v.sizeMm } : {}) });

// QR codes for printing. The code holds a short permanent address on our own server, so a printed banner never goes stale.
export default function QrCodesScreen() {
    const t = useTheme();
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    const [preview, setPreview] = useState('');
    const [demo, setDemo] = useState({ format: 'png', sizePx: 2048, dpi: 300, sizeMm: 200 });
    const [busy, setBusy] = useState('');
    const [q, setQ] = useState('');
    const [shops, setShops] = useState([]);
    const [shop, setShop] = useState(null);
    const [table, setTable] = useState({ format: 'pdf', sizePx: 1024, dpi: 300, sizeMm: 100 });
    const [logo, setLogo] = useState(false);
    const [one, setOne] = useState('');   // empty = all tables on one PDF sheet

    useEffect(() => {
        fetchQrInfo().then(setInfo).catch((e) => setError(errMsg(e)));
        fetchDemoPreview().then(setPreview).catch(() => { });
    }, []);
    useEffect(() => {
        const h = setTimeout(() => { fetchShops(q.trim() || undefined).then((x) => setShops((x.items || []).slice(0, 12))).catch(() => { }); }, 300);
        return () => clearTimeout(h);
    }, [q]);

    const run = async (key, fn) => {
        setBusy(key);
        try { await fn(); } catch (e) { if (!e.safe) toast(errMsg(e), 'error'); else toast(e.message, 'error'); } finally { setBusy(''); }
    };

    if (!info) return <Screen title="QR codes" subtitle="Demo and tables">{error ? <ErrorBox message={error} onRetry={() => fetchQrInfo().then(setInfo).catch((e) => setError(errMsg(e)))} /> : null}</Screen>;

    return (
        <Screen title="QR codes" subtitle="For banners, posters and table stickers">
            {info.warning ? <Hint tone="warn">{info.warning}</Hint> : <Hint>Printed codes keep working for ever: the code holds {info.base}/q/... and the server decides where it leads.</Hint>}

            <SectionTitle section="platform">Public demo</SectionTitle>
            <Card>
                {preview ? <View style={{ alignItems: 'center', marginBottom: spacing.md }}><View style={{ width: 200, height: 200, backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' }}><SvgXml xml={preview} width={200} height={200} /></View></View> : null}
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>Code holds: {info.demo.link}{'\n'}Leads to: {info.demo.destination}{'\n'}The demo code never carries a logo.</Text>
                <SizeChoices v={demo} set={setDemo} />
                <Button title="Download the demo QR" icon="copy" loading={busy === 'demo'} style={{ marginTop: spacing.md }} onPress={() => run('demo', () => downloadQr('/admin/qr/demo', paramsOf(demo), 'demo-qr'))} />
            </Card>

            <SectionTitle section="shops">Table codes for a shop</SectionTitle>
            <Card>
                {!shop ? (
                    <>
                        <SearchBar value={q} onChangeText={setQ} placeholder="Find the shop" />
                        {shops.map((s, i) => <ListRow key={s.id || s._id} section="shops" icon="food" title={s.name} subtitle={s.slug} onPress={() => setShop({ id: s.id || s._id, name: s.name })} last={i === shops.length - 1} />)}
                    </>
                ) : (
                    <>
                        <ListRow section="shops" icon="food" title={shop.name} subtitle="Tap to choose another shop" onPress={() => setShop(null)} last />
                        <View style={{ marginTop: spacing.md }}>
                            <ToggleRow title="Shop logo in the middle" subtitle="Optional. Tables only. The picture covers a fifth of the code at most." value={logo} onValueChange={setLogo} />
                            <Field label="Table number" hint="Leave empty for one PDF sheet with every table (the number under each code). Type a number for a single table file." value={one} onChangeText={(v) => setOne(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" placeholder="All tables" />
                            {one ? <SizeChoices v={table} set={setTable} /> : null}
                        </View>
                        <Button title={one ? `Download table ${one}` : 'Download the table sheet'} icon="copy" loading={busy === 'table'} style={{ marginTop: spacing.md }}
                            onPress={() => run('table', () => downloadQr(`/admin/qr/tables/${shop.id}`, { table: one || 'all', logo: logo ? '1' : '0', ...(one ? paramsOf(table) : { format: 'pdf' }) }, `${shop.name}-tables`))} />
                        <Hint>The shop needs dine in switched on.</Hint>
                    </>
                )}
            </Card>
        </Screen>
    );
}
