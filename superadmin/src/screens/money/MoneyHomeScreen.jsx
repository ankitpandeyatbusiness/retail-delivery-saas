import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Stat, SectionTitle, ListRow, Badge } from '../../components/ui';
import { SkeletonDashboard } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { platformLedger, listInvoices, fetchPlatform } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, rupees } from '../../utils/format';

const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

// The Money tab: what came in, what is waiting, and the doors to invoices, transactions, SMS and rules.
export default function MoneyHomeScreen() {
    const nav = useNavigation();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const to = new Date();
            const from = new Date(to.getTime() - 29 * 86400000);
            const [led, overdue, pending, plat] = await Promise.all([
                platformLedger({ from: ymd(from), to: ymd(to), limit: 1 }),
                listInvoices({ status: 'overdue', limit: 50 }),
                listInvoices({ status: 'pending', limit: 50 }),
                fetchPlatform(),
            ]);
            setD({
                received: led.totals?.inPaise || 0,
                pendingPaise: led.totals?.pending?.paise || 0,
                overdue: overdue.items, overdueMore: overdue.hasMore,
                waiting: pending.items.reduce((s, i) => s + (i.total || 0), 0),
                waitingCount: pending.items.length, waitingMore: pending.hasMore,
                businessSet: !!plat.business?.legalName,
                gstSet: !!plat.business?.gstin,
            });
            setError('');
        } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    const go = (screen, params) => () => nav.navigate(screen, params);

    return (
        <Screen tabScreen title="Money" subtitle="Rent, transactions and SMS" refreshing={refreshing} onRefresh={refresh}>
            {error && !d ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonDashboard /> : (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <Stat section="money" label="Received (30 days)" value={rupeesFromPaise(d.received)} icon="wallet" onPress={go('Ledger')} />
                        <Stat section={d.overdue.length ? 'alerts' : 'riders'} label="Overdue bills" value={`${d.overdue.length}${d.overdueMore ? '+' : ''}`} icon="warning" onPress={go('Invoices', { status: 'overdue' })} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                        <Stat label="Waiting to be paid" value={rupees(d.waiting)} icon="clock" tone={d.waiting ? 'warn' : undefined} onPress={go('Invoices', { status: 'pending' })} />
                        <Stat label="Pending transactions" value={rupeesFromPaise(d.pendingPaise)} icon="receipt" onPress={go('Ledger')} />
                    </View>

                    {!d.businessSet ? (
                        <Card onPress={go('PlatformBusiness')} style={{ marginTop: spacing.lg }}>
                            <Badge label="Set up first" tone="warn" icon="warning" />
                            <ListRow section="platform" icon="bank" title="Fill in your business details" subtitle="Needed before invoices can be made" last />
                        </Card>
                    ) : null}

                    <SectionTitle section="alerts">Am I in profit?</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="money" icon="chart" title="Profit and loss" subtitle="Income, costs and exactly why" onPress={go('ProfitLoss')} />
                        <ListRow section="alerts" icon="warning" title="Who owes you money" subtitle="Unpaid rent, late payers, never paid" onPress={go('Receivables')} />
                        <ListRow section="catalog" icon="wallet" title="Your expenses" subtitle="Hosting, SMS provider, staff..." onPress={go('Expenses')} last />
                    </Card>

                    <SectionTitle section="money">Invoices and money</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="money" icon="receipt" title="Rent invoices" subtitle="Monthly bills to shops: pay, waive, void, extend" onPress={go('Invoices')} />
                        <ListRow section="people" icon="wallet" title="Transactions" subtitle="Everything received from shops" onPress={go('Ledger')} last />
                    </Card>

                    <SectionTitle section="catalog">SMS</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="catalog" icon="chart" title="SMS profit" subtitle="Revenue minus cost, per shop" onPress={go('SmsProfit')} />
                        <ListRow section="catalog" icon="coupon" title="SMS prices" subtitle="Price, cost and top-up packs" onPress={go('PlatformSms')} last />
                    </Card>

                    <SectionTitle section="settings">Rules and details</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="money" icon="tune" title="Cancel and refund rules" subtitle="Who bears the cost of a cancelled order. Recommended in one tap" onPress={go('MoneyRules')} />
                        <ListRow section="money" icon="percent" title="GST on shop bills" subtitle="One rate for every shop, set only by you" onPress={go('Gst')} />
                        <ListRow section="settings" icon="tune" title="Billing rules" subtitle="Free service, due days, grace, price tiers" onPress={go('PlatformBilling')} />
                        <ListRow section="platform" icon="bank" title="Business details" subtitle={d.gstSet ? 'Printed on every invoice' : 'No GST number saved yet'} onPress={go('PlatformBusiness')} />
                        <ListRow section="money" icon="bank" title="My Razorpay" subtitle="Your account for SMS top-ups and rent" onPress={go('MyRazorpay')} last />
                    </Card>
                </>
            )}
        </Screen>
    );
}
