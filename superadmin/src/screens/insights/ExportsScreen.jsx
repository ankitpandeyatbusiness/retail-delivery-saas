import React, { useState } from 'react';
import { View } from 'react-native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, ListRow, SectionTitle } from '../../components/ui';
import { Hint } from '../../components/settingsForm';
import { toast } from '../../components/feedback';
import { shareOrdersCsv, shareInvoicesCsv, shareCustomersCsv } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { ymdOf } from '../../utils/format';

const RANGES = [{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 365, label: '1 year' }, { value: 0, label: 'Everything' }];

// Save your data as a coloured Excel sheet: up to 5,000 rows each.
export default function ExportsScreen() {
    const [days, setDays] = useState(30);
    const [busy, setBusy] = useState('');

    const go = async (kind, withRange = true) => {
        setBusy(kind);
        try {
            const params = {};
            if (withRange && days) params.from = ymdOf(new Date(Date.now() - days * 86400000).toISOString());
            await ({ orders: shareOrdersCsv, invoices: shareInvoicesCsv, customers: shareCustomersCsv })[kind](params);
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    return (
        <Screen title="Export data" subtitle="Excel sheets">
            <SectionTitle section="platform">How far back</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {RANGES.map((r) => <Chip key={r.value} label={r.label} active={days === r.value} onPress={() => setDays(r.value)} />)}
            </View>
            <SectionTitle section="money">Files</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="orders" icon="orders" title="Orders" subtitle={busy === 'orders' ? 'Preparing...' : 'All shops, newest first'} onPress={() => go('orders')} />
                <ListRow section="money" icon="receipt" title="Rent invoices" subtitle={busy === 'invoices' ? 'Preparing...' : 'Billed, paid and pending'} onPress={() => go('invoices')} />
                <ListRow section="people" icon="users" title="Customers" subtitle={busy === 'customers' ? 'Preparing...' : 'Name and masked phone, all shops'} onPress={() => go('customers', false)} last />
            </Card>
            <Hint>Opens in Excel, Google Sheets or WPS. Colours show status at a glance, money is formatted in rupees, and totals are at the bottom. Phone numbers are masked, and every cell is plain text, so nothing can run as a formula.</Hint>
        </Screen>
    );
}
