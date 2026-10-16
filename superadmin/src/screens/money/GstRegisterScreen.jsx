import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, SectionTitle, KeyValue, Button } from '../../components/ui';
import Icon from '../../components/Icon';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchGstRegister, shareGstRegister } from '../../api/gstApi';
import { errMsg } from '../../api/adminClient';
import { rupees } from '../../utils/format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const nowMonth = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
const shift = (m, d) => { const [y, mo] = m.split('-').map(Number); const x = new Date(Date.UTC(y, mo - 1 + d, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
const label = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });

// Every bill, SMS top-up invoice and credit note of a month, with the tax heads: what the business that issues them files its
// GST returns from. Anyone with a superadmin login can read it and download it as Excel.
export default function GstRegisterScreen() {
    const t = useTheme();
    const [month, setMonth] = useState(nowMonth());
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setR(null); setErr('');
        try { setR(await fetchGstRegister(month)); } catch (e) { setErr(errMsg(e)); }
    }, [month]);
    useEffect(() => { load(); }, [load]);

    const download = async () => {
        setBusy(true);
        try { await shareGstRegister(month); } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const s = r?.summary;
    const atNow = month >= nowMonth();

    return (
        <Screen title="GST register" subtitle="Bills, SMS top-up invoices and credit notes" onRefresh={load}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
                <Pressable onPress={() => setMonth(shift(month, -1))} hitSlop={12}><Icon name="back" size={26} color={t.text} /></Pressable>
                <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800' }}>{label(month)}</Text>
                <Pressable onPress={() => setMonth(shift(month, 1))} hitSlop={12} disabled={atNow}><Icon name="next" size={26} color={atNow ? t.border : t.text} /></Pressable>
            </View>
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {s ? (
                <>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <KeyValue label="Documents" value={String(s.documents)} />
                        <KeyValue label="Taxable value" value={rupees(s.taxable)} />
                        <KeyValue label="CGST" value={rupees(s.cgst)} />
                        <KeyValue label="SGST" value={rupees(s.sgst)} />
                        <KeyValue label="IGST" value={rupees(s.igst)} />
                        <KeyValue label="GST in total" value={rupees(s.gst)} />
                        <KeyValue label="Total with GST" value={rupees(s.total)} last />
                    </Card>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>
                        Credit notes are counted as minus. GST on bills the shops have not paid yet: {rupees(s.gstOnUnpaidBills)} ({s.unpaidBills} bill{s.unpaidBills === 1 ? '' : 's'}). It is due even before the shop pays.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
                        <Badge label={`Shops with GST number (B2B): ${s.b2b.documents}`} />
                        <Badge label={`Without (B2C): ${s.b2c.documents}`} />
                    </View>
                    <View style={{ marginTop: spacing.md }}><Button title="Download Excel" icon="download" onPress={download} loading={busy} disabled={!s.documents} /></View>

                    <SectionTitle section="money">This month</SectionTitle>
                    {r.rows.length ? (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                            {r.rows.map((x, i) => (
                                <View key={`${x.docNo}-${i}`} style={{ paddingVertical: spacing.md, borderBottomWidth: i === r.rows.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                        <Text style={{ color: t.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{x.docNo}</Text>
                                        <Text style={{ color: x.total < 0 ? t.danger : t.text, fontWeight: '800' }}>{rupees(x.total)}</Text>
                                    </View>
                                    <Text style={{ color: t.muted, fontSize: font.sm }} numberOfLines={1}>{x.type} · {x.buyer} · {day(x.date)}</Text>
                                    <Text style={{ color: t.muted, fontSize: font.sm }}>{x.gst ? `Tax ${rupees(x.gst)}${x.igst ? ' (IGST)' : ' (CGST+SGST)'}` : 'No tax'} · {x.supply}{x.against ? ` · cancels ${x.against}` : ''}</Text>
                                </View>
                            ))}
                        </Card>
                    ) : <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>No bills, top-up invoices or credit notes this month.</Text>}
                </>
            ) : null}
        </Screen>
    );
}
