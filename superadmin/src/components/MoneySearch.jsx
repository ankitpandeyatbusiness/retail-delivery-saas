// The answers of the Money tab's search box: rent bills, SMS top-ups, refunds, customer payments, expenses, notes, Razorpay events, what you marked handled.
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../theme';
import { Card, SectionTitle, ListRow } from './ui';
import { Loading, Empty } from './feedback';
import { searchMoney } from '../api/handledApi';
import { errMsg } from '../api/adminClient';
import { rupeesFromPaise } from '../utils/format';
import { goTab } from '../navigation/goTo';

const ICON = { shops: 'shops', invoices: 'receipt', topups: 'wallet', refunds: 'rupee', payments: 'rupee', expenses: 'wallet', notes: 'notes', events: 'warning', handled: 'ok' };

export default function MoneySearch({ q }) {
    const t = useTheme();
    const nav = useNavigation();
    const [r, setR] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const seq = useRef(0);

    useEffect(() => {
        const text = q.trim();
        if (text.length < 2) { setR(null); setError(''); return undefined; }
        const id = setTimeout(async () => {
            const mine = ++seq.current;
            setBusy(true);
            try { const res = await searchMoney(text); if (mine === seq.current) { setR(res); setError(''); } } catch (e) { if (mine === seq.current) setError(errMsg(e)); } finally { if (mine === seq.current) setBusy(false); }
        }, 300);
        return () => clearTimeout(id);
    }, [q]);

    const open = (o) => { if (!o) return; if (o.tab) goTab(nav, o.tab, { screen: o.screen, params: o.params }); else nav.navigate(o.screen, o.params); };

    return (
        <View>
            {q.trim().length < 2 ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>Keep typing: a shop, a bill number (SUB/...), a payment id (pay_...), an amount, a top-up reference (SAV-T7), a word like "hosting", "failed" or "pending". Use several words together.</Text> : null}
            {busy && !r ? <Loading /> : null}
            {error ? <Text style={{ color: t.danger, marginTop: spacing.md }}>{error}</Text> : null}
            {r && !r.groups.length && !busy ? <Empty icon="search" title="Nothing found" hint="Try fewer words, or part of a number." /> : null}
            {r ? r.groups.map((g) => (
                <View key={g.key}>
                    <SectionTitle section="money">{g.title}</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {g.items.map((it, i) => (
                            <ListRow
                                key={it.id}
                                section="money"
                                icon={ICON[g.key] || 'receipt'}
                                title={it.paise ? `${it.title} · ${rupeesFromPaise(it.paise)}` : it.title}
                                subtitle={it.detail}
                                onPress={() => open(it.open)}
                                last={i === g.items.length - 1}
                            />
                        ))}
                    </Card>
                </View>
            )) : null}
        </View>
    );
}
