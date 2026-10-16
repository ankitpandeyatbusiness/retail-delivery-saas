import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, KeyValue, Button } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { StatusBadge, PaySheet, SetOffSheet, rs, dayOf, nameOf, CATEGORY_LABEL } from '../../components/settlementBits';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchSettlementEntry, fetchSettlementConfig, confirmSettlementClaim, rejectSettlementClaim } from '../../api/settlementApi';
import { errMsg } from '../../api/adminClient';

const ACTION = {
    created: 'Row made', paid: 'Payment recorded', claim: '“I have paid” note', claim_confirmed: 'Note confirmed as paid', claim_rejected: 'Note rejected',
    setoff: 'Set off', brought_by: 'Ratio changed', edited: 'Edited', voided: 'Cancelled', restored: 'Restored',
};
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '');

// One row of the sheet: what is left to pay, how it is shared, and the whole timeline (who did what, when, the reference).
export default function SettlementEntryScreen() {
    const t = useTheme();
    const { id } = useRoute().params;
    const supreme = useSupreme();
    const [row, setRow] = useState(null);
    const [cfg, setCfg] = useState(null);
    const [err, setErr] = useState('');
    const [pay, setPay] = useState(false);
    const [claim, setClaim] = useState(false);
    const [off, setOff] = useState(false);
    const [rejectOpen, setRejectOpen] = useState(false);

    const load = useCallback(async () => {
        setErr('');
        try { const [r, c] = await Promise.all([fetchSettlementEntry(id), fetchSettlementConfig()]); setRow(r); setCfg(c); } catch (e) { setErr(errMsg(e)); }
    }, [id]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const confirm = async () => { try { await confirmSettlementClaim(id); toast('Confirmed'); load(); } catch (e) { toast(errMsg(e), 'error'); } };
    const open = row && row.owes && row.status !== 'paid' && !row.voided;
    const other = (side) => nameOf(cfg, side === 'owner' ? 'partner' : 'owner');

    return (
        <Screen title={row ? `Row #${row.no}` : 'Row'} onRefresh={load}>
            {!row && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {row && cfg ? (
                <>
                    <Card>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={2}>{row.title}</Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
                            <Text style={{ color: t.text, fontSize: font.xxl, fontWeight: '900', flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit>{row.owes ? rs(row.remaining) : '—'}</Text>
                            <StatusBadge row={row} />
                        </View>
                        <Text style={{ color: row.late ? t.danger : t.muted, marginTop: 4 }}>
                            {row.voided ? 'The payment behind this row was undone, so it no longer counts.'
                                : row.owes ? `${nameOf(cfg, row.owes)} pays ${other(row.owes)}${row.status !== 'paid' ? `, by ${dayOf(row.dueAt)}${row.late ? ' (late)' : ''}` : ''}. ${row.paidAmount ? `${rs(row.paidAmount)} paid so far.` : ''}`
                                    : 'Everything is the owner’s. Nothing to settle.'}
                        </Text>
                    </Card>

                    <SectionTitle section="money">How it is shared</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {row.kind === 'receipt' ? (
                            <>
                                <KeyValue label="The shop paid" value={`${rs(row.totalAmount)}${row.gstAmount ? ' with GST' : ''}`} />
                                <KeyValue label="Shared (before GST)" value={rs(row.baseAmount)} />
                            </>
                        ) : <KeyValue label={`Whole amount, paid by ${nameOf(cfg, row.paidBy) || 'one of you'}`} value={rs(row.amount)} />}
                        <KeyValue label="Split" value={`${row.ratio.ownerPct} / ${row.ratio.partnerPct}`} />
                        <KeyValue label={`${cfg.ownerName}’s share`} value={rs(row.ownerShare)} />
                        <KeyValue label={`${cfg.partnerName}’s share`} value={rs(row.partnerShare)} last />
                    </Card>

                    <SectionTitle section="orders">Details</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <KeyValue label="Kind" value={CATEGORY_LABEL[row.category] || row.category} />
                        {row.shopName ? <KeyValue label="Shop" value={row.shopName} /> : null}
                        {row.kind === 'receipt' ? <KeyValue label="Shop brought by" value={row.broughtBy ? nameOf(cfg, row.broughtBy) : 'Not marked yet'} /> : null}
                        {row.kind === 'receipt' ? <KeyValue label="Money received by" value={nameOf(cfg, row.receivedBy)} /> : null}
                        {row.invoiceNo ? <KeyValue label="Invoice" value={row.invoiceNo} /> : null}
                        <KeyValue label="Date" value={dayOf(row.date)} last />
                    </Card>
                    {row.note ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>Note: {row.note}</Text> : null}

                    {row.claim?.state === 'open' ? (
                        <Card style={{ marginTop: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '800' }}>“I have paid” note</Text>
                            <Text style={{ color: t.muted, marginTop: 2 }}>{row.claim.by?.name || 'The partner'} says {rs(row.claim.amount)} was paid on {dayOf(row.claim.date)}{row.claim.ref ? `, ref ${row.claim.ref}` : ''}.{row.claim.note ? ` “${row.claim.note}”` : ''}</Text>
                            {supreme ? (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                                    <View style={{ flexGrow: 1, flexBasis: 140 }}><Button title="Yes, received" icon="check" onPress={confirm} /></View>
                                    <View style={{ flexGrow: 1, flexBasis: 140 }}><Button title="Not received" kind="outline" onPress={() => setRejectOpen(true)} /></View>
                                </View>
                            ) : <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>Waiting for the supreme admin to confirm.</Text>}
                        </Card>
                    ) : null}

                    {open ? (
                        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                            {supreme ? <Button title="Record a payment" icon="check" onPress={() => setPay(true)} /> : null}
                            {supreme ? <Button title="Set off against another row" icon="swap-horizontal" kind="outline" onPress={() => setOff(true)} /> : null}
                            {!supreme && row.claim?.state !== 'open' ? <Button title="I have paid" icon="check" onPress={() => setClaim(true)} /> : null}
                        </View>
                    ) : null}

                    <SectionTitle section="platform">Timeline</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {[...row.events].reverse().map((e, i, all) => (
                            <View key={i} style={{ paddingVertical: spacing.md, borderBottomWidth: i === all.length - 1 ? 0 : 1, borderBottomColor: t.border }}>
                                <Text style={{ color: t.text, fontWeight: '800' }}>{ACTION[e.action] || e.action}{e.amount ? ` · ${rs(e.amount)}` : ''}</Text>
                                <Text style={{ color: t.muted, fontSize: font.sm }}>{when(e.at)}{e.by?.name ? ` · ${e.by.name}` : ''}{e.date && e.action !== 'created' ? ` · money moved ${dayOf(e.date)}` : ''}</Text>
                                {e.ref ? <Text style={{ color: t.muted, fontSize: font.sm }}>Ref: {e.ref}</Text> : null}
                                {e.note ? <Text style={{ color: t.muted, fontSize: font.sm }}>{e.note}</Text> : null}
                            </View>
                        ))}
                    </Card>

                    <PaySheet visible={pay} onClose={() => setPay(false)} row={row} onDone={load} />
                    <PaySheet visible={claim} onClose={() => setClaim(false)} row={row} claim onDone={load} />
                    <SetOffSheet visible={off} onClose={() => setOff(false)} row={row} cfg={cfg} onDone={load} />
                    <ConfirmSheet
                        visible={rejectOpen} onClose={() => setRejectOpen(false)} title="Not received?" message="The note stays on the row's timeline, marked as rejected."
                        confirmLabel="Reject the note" needReason reasonLabel="Why"
                        onConfirm={async (reason) => { try { await rejectSettlementClaim(id, reason); toast('Rejected'); load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } }}
                    />
                </>
            ) : null}
        </Screen>
    );
}
