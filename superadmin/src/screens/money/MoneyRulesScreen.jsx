import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { spacing, font, useTheme } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Group, NumberField, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { platformMoneyRules, savePlatformMoneyRules } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';

// Who bears the cost when an order paid online is cancelled or not collected. These are the most a shop can keep: a shop owner can
// only be kinder to the customer, never harder. "Use recommended" puts the suggested numbers back in one tap.
export default function MoneyRulesScreen() {
    const t = useTheme();
    const [f, setF] = useState(null);
    const [rec, setRec] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { const r = await platformMoneyRules(); setF(r.rules); setRec(r.recommended); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!f) return <Screen title="Cancel and refund rules">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const set = (k) => (v) => setF({ ...f, [k]: v ?? 0 });
    const done = (r, msg) => { setF(r.rules); setRec(r.recommended); toast(msg); };
    const save = async () => {
        setBusy(true);
        try { done(await savePlatformMoneyRules(f), 'Saved for every shop'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const reset = async () => {
        setBusy(true);
        try { done(await savePlatformMoneyRules({ reset: true }), 'Recommended rules are back'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const hint = (k) => `Recommended: ${rec[k]}`;

    return (
        <Screen title="Cancel and refund rules" subtitle="For orders paid online" footer={<Button title="Save" icon="check" onPress={save} loading={busy} />}>
            <Group title="When the customer cancels" section="money" hint="The share of the food the shop keeps. The rest is refunded. A shop owner can lower these for his own shop, never raise them.">
                <NumberField label="Free time after the shop accepts" suffix="minutes" integer value={f.graceMinutes} onChange={set('graceMinutes')} hint={hint('graceMinutes')} />
                <NumberField label="Shop keeps after accepting" suffix="%" integer value={f.accepted} onChange={set('accepted')} hint={hint('accepted')} />
                <NumberField label="Shop keeps while it is being prepared" suffix="%" integer value={f.preparing} onChange={set('preparing')} hint={hint('preparing')} />
                <NumberField label="Shop keeps when it is ready" suffix="%" integer value={f.ready} onChange={set('ready')} hint={hint('ready')} />
                <NumberField label="Shop keeps when it is on the road" suffix="%" integer value={f.out_for_delivery} onChange={set('out_for_delivery')} hint={hint('out_for_delivery')} last />
            </Group>
            <Group title="When the customer does not come or cannot be reached" section="money" hint="Marked by the owner as the customer's fault: a pickup nobody collected, or a delivery to someone who did not answer.">
                <NumberField label="Shop keeps" suffix="%" integer value={f.noShow} onChange={set('noShow')} hint={hint('noShow')} last />
            </Group>
            <Card style={{ marginTop: spacing.lg }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>Always a full refund</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>
                    When the shop, the delivery partner or the platform is at fault, the shop did not accept in time, the payment timed out, or the delivery was more than an hour late.
                </Text>
            </Card>
            <Button title="Use recommended rules" icon="refresh" kind="ghost" onPress={reset} loading={busy} style={{ marginTop: spacing.lg }} />
            <Hint>Cash orders have nothing to refund. A customer who cancels a cash order late gets a strike instead.</Hint>
        </Screen>
    );
}
