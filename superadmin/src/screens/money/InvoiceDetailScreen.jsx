import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, ListRow, Badge } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { Choice, NumberField } from '../../components/settingsForm';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { InvoiceBadge, invoiceTone } from '../../components/invoiceBits';
import { getInvoice, setInvoiceStatus, voidInvoice, waiveInvoice, extendGrace, resendInvoiceNotice, shareRentInvoicePdf } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupees, dateOnly, dateTime, titleCase } from '../../utils/format';

const MODES = [
    { value: 'upi', label: 'UPI' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' },
    { value: 'cheque', label: 'Cheque' }, { value: 'other', label: 'Other' },
];

function Line({ label, value, strong }) {
    const t = useTheme();
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
            <Text style={{ color: strong ? t.text : t.muted, fontWeight: strong ? '800' : '500', fontSize: strong ? font.lg : font.md }}>{label}</Text>
            <Text style={{ color: t.text, fontWeight: strong ? '800' : '600', fontSize: strong ? font.lg : font.md }}>{value}</Text>
        </View>
    );
}

// One rent invoice: what it is, who owes it, and every action the platform can take on it.
export default function InvoiceDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { invoiceId, invoiceNo } = useRoute().params;
    const [inv, setInv] = useState(null);
    const [shop, setShop] = useState(null);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);     // paid | grace
    const [mode, setMode] = useState('upi');
    const [ref, setRef] = useState('');
    const [note, setNote] = useState('');
    const [days, setDays] = useState(3);
    const [busy, setBusy] = useState('');
    const [confirm, setConfirm] = useState(null); // void | waive | undo | resend

    const load = useCallback(async () => {
        try { setInv(await getInvoice(invoiceId)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [invoiceId]);
    useEffect(() => { load(); }, [load]);

    if (!inv) return <Screen title={invoiceNo || 'Invoice'}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const pending = inv.status === 'pending';
    const tone = invoiceTone(inv);
    const section = { success: 'money', neutral: 'platform', danger: 'alerts', warn: 'catalog' }[tone];
    const act = async (key, fn, ok) => {
        setBusy(key);
        try { await fn(); toast(ok); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(''); }
    };
    const pdf = async () => {
        setBusy('pdf');
        try { await shareRentInvoicePdf(inv); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not get the PDF'), 'error'); } finally { setBusy(''); }
    };

    return (
        <Screen title={inv.invoiceNo} subtitle={inv.buyer?.legalName || 'Rent invoice'} refreshing={false} onRefresh={load}>
            <Hero
                section={section}
                title={rupees(inv.total)}
                subtitle={inv.kind === 'custom' ? inv.description || 'Custom invoice' : `Rent for ${inv.period}`}
                right={<InvoiceBadge invoice={inv} />}
            >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <Badge label={`Issued ${dateOnly(inv.issueDate)}`} />
                    <Badge label={`Due ${dateOnly(inv.dueDate)}`} tone={inv.overdue ? 'danger' : 'neutral'} icon="clock" />
                    {inv.graceEndsAt && pending ? <Badge label={`Shop pauses ${dateOnly(inv.graceEndsAt)}`} tone="warn" icon="warning" /> : null}
                    {inv.kind === 'custom' && inv.graceEndsAt === undefined ? <Badge label="Never pauses the shop" tone="info" /> : null}
                </View>
            </Hero>

            <SectionTitle section="money">Amount</SectionTitle>
            <Card>
                {inv.lineItems?.length ? inv.lineItems.map((l, i) => (
                    <View key={i} style={{ paddingVertical: 4 }}>
                        <Text style={{ color: t.text, fontWeight: '600' }}>{l.description}</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm }}>{l.qty} × {rupees(l.rate)} = {rupees(l.amount)}</Text>
                    </View>
                )) : <Text style={{ color: t.text }}>{inv.description}{inv.orderCount != null ? ` · ${inv.orderCount} orders` : ''}{inv.tierLabel ? ` · ${inv.tierLabel}` : ''}</Text>}
                <View style={{ height: 1, backgroundColor: t.border, marginVertical: spacing.sm }} />
                <Line label="Amount" value={rupees(inv.baseAmount)} />
                {inv.gstPercent ? <Line label={`GST ${inv.gstPercent}%`} value={rupees(inv.gstAmount)} /> : null}
                <Line label="Total" value={rupees(inv.total)} strong />
            </Card>

            {inv.status !== 'pending' || inv.paidAt ? (
                <>
                    <SectionTitle section="platform">Status</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Status" value={titleCase(inv.status)} />
                        {inv.paidAt ? <KeyValue label="Paid at" value={dateTime(inv.paidAt)} /> : null}
                        {inv.paymentMode ? <KeyValue label="Paid by" value={titleCase(inv.paymentMode)} /> : null}
                        {inv.paymentRef ? <KeyValue label="Reference" value={inv.paymentRef} /> : null}
                        {inv.voidedAt ? <KeyValue label="Voided" value={`${dateTime(inv.voidedAt)}${inv.voidReason ? ` · ${inv.voidReason}` : ''}`} /> : null}
                        {inv.note ? <KeyValue label="Note" value={inv.note} /> : null}
                        <KeyValue label="Last changed by" value={inv.markedBy} last />
                    </Card>
                </>
            ) : null}

            <SectionTitle section="people">Billed to</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Name" value={inv.buyer?.legalName} />
                <KeyValue label="Address" value={inv.buyer?.address} />
                <KeyValue label="GST number" value={inv.buyer?.gstin} />
                <KeyValue label="Phone" value={inv.buyer?.phone} last />
            </Card>

            <SectionTitle section="settings">Actions</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                {pending ? (
                    <>
                        <ListRow section="money" icon="ok" title="Mark as paid" subtitle="Unpauses the shop at once" onPress={() => { setMode('upi'); setRef(''); setNote(''); setSheet('paid'); }} />
                        <ListRow section="catalog" icon="clock" title="Give more time" subtitle="Move the day the shop pauses" onPress={() => { setDays(3); setSheet('grace'); }} />
                        <ListRow section="platform" icon="bell" title="Send the notice again" subtitle="Tell the owner about this bill" onPress={() => setConfirm('resend')} />
                        <ListRow section="people" icon="shield" title="Waive this bill" subtitle="The shop does not have to pay" onPress={() => setConfirm('waive')} />
                        <ListRow danger section="alerts" icon="block" title="Void this invoice" subtitle="Made by mistake" onPress={() => setConfirm('void')} />
                    </>
                ) : null}
                {inv.status === 'paid' ? <ListRow section="catalog" icon="back" title="Undo: mark as unpaid" subtitle="Use if it was marked paid by mistake" onPress={() => setConfirm('undo')} /> : null}
                <ListRow section="orders" icon="receipt" title="Share the PDF" subtitle="Send the invoice to the shop" onPress={pdf} />
                <ListRow
                    section="shops"
                    icon="shops"
                    title="Open the shop's billing"
                    subtitle={inv.buyer?.legalName}
                    onPress={() => nav.navigate('ShopsTab', { screen: 'ShopBilling', params: { shopId: String(inv.tenantId), name: inv.buyer?.legalName } })}
                    last
                />
            </Card>

            <Sheet visible={sheet === 'paid'} onClose={() => setSheet(null)} title="Mark as paid">
                <Choice label="How was it paid?" options={MODES} value={mode} onChange={setMode} />
                <Field label="Reference (optional)" value={ref} onChangeText={setRef} maxLength={60} placeholder="UPI reference, cheque number..." />
                <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} />
                <Button
                    title={`Mark ${rupees(inv.total)} as paid`}
                    loading={busy === 'paid'}
                    onPress={async () => {
                        try {
                            await act('paid', () => setInvoiceStatus(invoiceId, { status: 'paid', paymentMode: mode, ...(ref.trim() ? { paymentRef: ref.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) }), 'Marked as paid');
                            setSheet(null);
                        } catch (e) { /* shown */ }
                    }}
                />
            </Sheet>

            <Sheet visible={sheet === 'grace'} onClose={() => setSheet(null)} title="Give more time">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>The shop is paused when the grace period ends. Add days to move that date.</Text>
                <NumberField label="Extra days" integer value={days} onChange={(v) => setDays(v ?? 1)} hint="1 to 60" />
                <Button
                    title="Extend"
                    loading={busy === 'grace'}
                    onPress={async () => { try { await act('grace', () => extendGrace(invoiceId, Math.max(1, Math.min(60, days || 1))), 'Grace extended'); setSheet(null); } catch (e) { /* shown */ } }}
                />
            </Sheet>

            <ConfirmSheet
                visible={confirm === 'resend'}
                onClose={() => setConfirm(null)}
                title="Send the notice again?"
                message="The owner gets the bill notice (or the paused notice if the grace period ended)."
                confirmLabel="Send"
                onConfirm={() => act('resend', () => resendInvoiceNotice(invoiceId), 'Notice sent')}
            />
            <ConfirmSheet
                visible={confirm === 'waive'}
                onClose={() => setConfirm(null)}
                title="Waive this bill?"
                message="It ends the bill and unpauses the shop. The shop pays nothing."
                confirmLabel="Waive"
                needReason
                onConfirm={(r) => act('waive', () => waiveInvoice(invoiceId, r), 'Bill waived')}
            />
            <ConfirmSheet
                visible={confirm === 'void'}
                onClose={() => setConfirm(null)}
                title="Void this invoice?"
                message="Use this for an invoice made by mistake. It cannot be undone."
                confirmLabel="Void"
                danger
                needReason
                onConfirm={(r) => act('void', () => voidInvoice(invoiceId, r), 'Invoice voided')}
            />
            <ConfirmSheet
                visible={confirm === 'undo'}
                onClose={() => setConfirm(null)}
                title="Mark as unpaid again?"
                message="The bill becomes pending, and the shop can be paused again if its grace period is over."
                confirmLabel="Mark unpaid"
                danger
                onConfirm={() => act('undo', () => setInvoiceStatus(invoiceId, { status: 'pending' }), 'Marked as unpaid')}
            />
        </Screen>
    );
}
