import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Badge } from '../../components/ui';
import { Group, NumberField, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import TiersEditor, { tiersProblem } from '../../components/tiersEditor';
import { fetchPlatform, saveBillingRules, saveTiers } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';

const DEFAULT_TIERS = [{ upTo: 305, fee: 3000 }, { upTo: 1005, fee: 6000 }, { upTo: null, fee: 10000 }];

// The rent rules for every shop: free allowance, when a bill is due, grace before pausing, and the price tiers.
export default function PlatformBillingScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [p, setP] = useState(null);
    const [rules, setRules] = useState(null);
    const [tiers, setTiers] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            const r = await fetchPlatform();
            const b = r.billing || {};
            setP(r);
            setRules({ dueDays: b.dueDays ?? 7, graceDays: b.graceDays ?? 5, freeOrders: b.freeOrders ?? 100, freeMonths: b.freeMonths ?? 2 });
            setTiers((b.tiers && b.tiers.length ? b.tiers : DEFAULT_TIERS).map((x) => ({ upTo: x.upTo, fee: x.fee })));
            setError('');
        } catch (e) { setError(errMsg(e)); }
    };
    useEffect(() => { load(); }, []);

    if (!rules) return <Screen title="Billing rules">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const set = (k) => (v) => setRules((r) => ({ ...r, [k]: v ?? 0 }));
    const problem = tiersProblem(tiers);

    const save = async () => {
        if (problem) { toast(problem, 'error'); return; }
        setBusy(true);
        try {
            await saveBillingRules({ dueDays: rules.dueDays, graceDays: rules.graceDays, freeOrders: rules.freeOrders, freeMonths: rules.freeMonths });
            await saveTiers(tiers);
            toast('Billing rules saved');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Billing rules" subtitle="For every shop" footer={<Button title="Save rules" icon="check" onPress={save} loading={busy} />}>
            <Group title="Free service" section="money" hint="A new shop is free until it goes live. After that it is free until the first of these limits.">
                <NumberField label="Free orders" integer value={rules.freeOrders} onChange={set('freeOrders')} hint="Orders that earn money for the shop" />
                <NumberField label="Free months" integer value={rules.freeMonths} onChange={set('freeMonths')} hint="Counted from the go-live day" last />
            </Group>

            <Group title="When a bill is due" section="catalog">
                <NumberField label="Days to pay" integer value={rules.dueDays} onChange={set('dueDays')} hint="From the issue date to the due date. 0 to 60." />
                <NumberField label="Grace days before pausing the shop" integer value={rules.graceDays} onChange={set('graceDays')} hint="After the bill is issued. 0 to 60." last />
            </Group>

            <Group title="Monthly rent by orders" section="shops" hint="The fee for a month depends on how many orders earned money that month. A shop can have its own tiers (Shop → Billing).">
                <TiersEditor value={tiers} onChange={setTiers} />
                {problem ? <Hint tone="warn">{problem}</Hint> : null}
                <Hint>Only invoices made from now on use these numbers. Invoices already issued never change.</Hint>
            </Group>
            {p?.business?.gstin ? null : <Hint tone="warn">GST is not added to invoices until your GST number is saved in Business details.</Hint>}
        </Screen>
    );
}
