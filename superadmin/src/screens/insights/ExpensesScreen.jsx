import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { listExpenses } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateOnly, titleCase } from '../../utils/format';

// The money you spend to run the platform. Needed for an honest profit and loss.
export default function ExpensesScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try { setItems((await listExpenses()).items); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    return (
        <Screen
            title="Your expenses"
            subtitle="Hosting, SMS provider, staff..."
            refreshing={refreshing}
            onRefresh={refresh}
            footer={<Button title="Add an expense" icon="add" onPress={() => nav.navigate('ExpenseForm')} />}
        >
            {error && !items ? <ErrorBox message={error} onRetry={load} /> : !items ? <SkeletonList /> : items.length === 0 ? (
                <Empty icon="wallet" title="No expenses yet" hint="Add what you pay every month so the profit number is true." />
            ) : items.map((e) => (
                <Card key={e.id} onPress={() => nav.navigate('ExpenseForm', { expense: e })} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', flex: 1 }}>{titleCase(e.category)}{e.vendor ? ` · ${e.vendor}` : ''}</Text>
                        <Text style={{ color: t.danger, fontSize: font.md, fontWeight: '800' }}>{rupeesFromPaise(e.amountPaise)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
                        <Text style={{ color: t.muted, fontSize: font.sm }}>{dateOnly(e.date)}</Text>
                        {e.repeatMonthly ? <Badge label={e.endsOn ? `Every month until ${dateOnly(e.endsOn)}` : 'Every month'} tone="info" icon="clock" /> : null}
                    </View>
                    {e.note ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>{e.note}</Text> : null}
                </Card>
            ))}
        </Screen>
    );
}
