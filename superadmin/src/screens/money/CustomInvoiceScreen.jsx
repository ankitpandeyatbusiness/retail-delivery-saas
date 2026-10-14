import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, NumberField, Switch, Hint } from '../../components/settingsForm';
import { toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { createCustomInvoice } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupees } from '../../utils/format';

const blankLine = () => ({ description: '', qty: 1, rate: undefined });

// A bill outside the monthly rent (set-up fee, extra work...). Up to 20 lines.
export default function CustomInvoiceScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [lines, setLines] = useState([blankLine()]);
    const [gst, setGst] = useState(18);
    const [dueDays, setDueDays] = useState(7);
    const [graceDays, setGraceDays] = useState(5);
    const [blocks, setBlocks] = useState(false);
    const [note, setNote] = useState('');
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);

    const setLine = (i, patch) => setLines((l) => l.map((x, n) => (n === i ? { ...x, ...patch } : x)));
    const base = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
    const gstAmt = (base * (gst || 0)) / 100;

    const create = async () => {
        for (let i = 0; i < lines.length; i += 1) {
            if (!lines[i].description.trim()) { toast(`Line ${i + 1}: write what it is for`, 'error'); return; }
            if (!(lines[i].rate >= 0) || lines[i].rate === undefined) { toast(`Line ${i + 1}: enter the rate`, 'error'); return; }
            if (!(lines[i].qty > 0)) { toast(`Line ${i + 1}: enter the quantity`, 'error'); return; }
        }
        if (!(base > 0)) { toast('The total must be more than 0', 'error'); return; }
        setBusy(true);
        try {
            const inv = await createCustomInvoice(shopId, {
                lineItems: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty), rate: Number(l.rate) })),
                gstPercent: gst ?? 0, dueDays, graceDays, blocksShop: blocks,
                ...(title.trim() ? { description: title.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
            });
            toast(`Invoice ${inv.invoiceNo} created`);
            nav.replace('InvoiceDetail', { invoiceId: String(inv._id), invoiceNo: inv.invoiceNo });
        } catch (e) { toast(errMsg(e), 'error'); setBusy(false); }
    };

    return (
        <Screen
            title="Custom invoice"
            subtitle={name}
            footer={<Button title={`Create invoice · ${rupees(base + gstAmt)}`} icon="check" onPress={create} loading={busy} />}
        >
            <Group title="What is it for" section="catalog">
                <Field label="Heading of the invoice (optional)" value={title} onChangeText={setTitle} maxLength={200} placeholder="e.g. Set-up and training" />
                {lines.map((l, i) => (
                    <View key={i} style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, backgroundColor: t.surfaceAlt }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                            <Text style={{ color: t.text, fontWeight: '800' }}>Line {i + 1}</Text>
                            {lines.length > 1 ? <Pressable onPress={() => setLines((x) => x.filter((_, n) => n !== i))} hitSlop={8}><Icon name="trash" size={18} color={t.danger} /></Pressable> : null}
                        </View>
                        <Field label="Description" value={l.description} onChangeText={(v) => setLine(i, { description: v })} maxLength={200} placeholder="e.g. Set-up and training" />
                        <View style={{ flexDirection: 'row', gap: spacing.md }}>
                            <NumberField style={{ flex: 1 }} label="Quantity" value={l.qty} onChange={(v) => setLine(i, { qty: v })} last />
                            <NumberField style={{ flex: 1 }} label="Rate" prefix="₹" value={l.rate} onChange={(v) => setLine(i, { rate: v })} last />
                        </View>
                    </View>
                ))}
                {lines.length < 20 ? <Button title="Add a line" kind="soft" small icon="add" onPress={() => setLines((x) => [...x, blankLine()])} /> : null}
            </Group>

            <Group title="Tax and dates" section="money">
                <NumberField label="GST" suffix="%" value={gst} onChange={(v) => setGst(v ?? 0)} hint="Only added if your GST number is saved in Business details" />
                <NumberField label="Days to pay" integer value={dueDays} onChange={(v) => setDueDays(v ?? 0)} />
                <Switch title="Can pause the shop if unpaid" subtitle="Off = this bill never pauses the shop" value={blocks} onValueChange={setBlocks} last={!blocks} />
                {blocks ? <View style={{ marginTop: spacing.md }}><NumberField label="Grace days before pausing" integer value={graceDays} onChange={(v) => setGraceDays(v ?? 1)} last /></View> : null}
            </Group>

            <Group title="Note" section="platform">
                <Field label="Note on the invoice (optional)" value={note} onChangeText={setNote} maxLength={200} />
                <Hint>Amount {rupees(base)} + GST {rupees(gstAmt)} = {rupees(base + gstAmt)}</Hint>
            </Group>
        </Screen>
    );
}
