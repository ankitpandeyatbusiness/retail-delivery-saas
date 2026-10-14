import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Badge } from './ui';
import { useTheme, spacing, radius, font } from '../theme';
import { rupees, dateOnly } from '../utils/format';

// one colour per invoice state; "overdue" = pending and past its due date
export const invoiceTone = (inv) => (inv.status === 'paid' ? 'success' : inv.status === 'void' ? 'neutral' : inv.overdue ? 'danger' : 'warn');
export const invoiceLabel = (inv) => (inv.status === 'paid' ? 'Paid' : inv.status === 'void' ? 'Void' : inv.overdue ? 'Overdue' : 'Pending');

export function InvoiceBadge({ invoice }) {
    return <Badge label={invoiceLabel(invoice)} tone={invoiceTone(invoice)} />;
}

export function InvoiceRow({ invoice, onPress, showShop = true }) {
    const t = useTheme();
    const tone = invoiceTone(invoice);
    const edge = { success: t.success, neutral: t.muted, danger: t.danger, warn: t.warn }[tone];
    return (
        <Pressable onPress={onPress} android_ripple={{ color: t.border }} style={({ pressed }) => [s.row, { backgroundColor: t.surface, opacity: pressed ? 0.9 : 1 }, t.shadow]}>
            <View style={[s.edge, { backgroundColor: edge }]} />
            <View style={{ flex: 1, padding: spacing.md, paddingLeft: spacing.lg }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{invoice.invoiceNo}</Text>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{rupees(invoice.total)}</Text>
                </View>
                {showShop ? <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{invoice.shopName}</Text> : null}
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>
                    {invoice.kind === 'custom' ? invoice.description || 'Custom invoice' : `Month ${invoice.period}`}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                    <InvoiceBadge invoice={invoice} />
                    {invoice.kind === 'custom' ? <Badge label="Custom" tone="info" /> : null}
                    <Text style={{ color: t.muted, fontSize: font.xs }}>{invoice.status === 'paid' ? `Paid ${dateOnly(invoice.paidAt)}` : `Due ${dateOnly(invoice.dueDate)}`}</Text>
                </View>
            </View>
        </Pressable>
    );
}

const s = StyleSheet.create({
    row: { flexDirection: 'row', borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm },
    edge: { width: 5 },
});
