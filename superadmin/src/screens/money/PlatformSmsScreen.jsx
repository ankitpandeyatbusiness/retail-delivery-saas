import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Badge } from '../../components/ui';
import { Group, NumberField, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { fetchPlatformSms, savePlatformSms } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { toPaise } from '../../utils/format';

// SMS prices for all shops. Typed in rupees; the server keeps whole paise.
export default function PlatformSmsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [f, setF] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            const { sms } = await fetchPlatformSms();
            setF({
                rate: sms.ratePerSmsPaise / 100, cost: sms.costPerSmsPaise / 100, low: sms.lowBalancePaise / 100,
                gst: sms.gstPercent ?? 18, min: sms.minTopupPaise / 100, max: sms.maxTopupPaise / 100, packs: (sms.packs || []).map((p) => p / 100),
            });
            setError('');
        } catch (e) { setError(errMsg(e)); }
    };
    useEffect(() => { load(); }, []);

    if (!f) return <Screen title="SMS prices">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v ?? 0 }));
    const margin = (f.rate || 0) - (f.cost || 0);

    const save = async () => {
        if (f.packs.length < 1) { toast('Keep at least one top-up pack', 'error'); return; }
        if (f.min > f.max) { toast('The smallest top-up cannot be above the largest', 'error'); return; }
        setBusy(true);
        try {
            await savePlatformSms({
                ratePerSmsPaise: toPaise(f.rate), costPerSmsPaise: toPaise(f.cost), lowBalancePaise: toPaise(f.low),
                gstPercent: f.gst, minTopupPaise: toPaise(f.min), maxTopupPaise: toPaise(f.max), packs: f.packs.map(toPaise),
            });
            toast('SMS prices saved');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="SMS prices" subtitle="For every shop" footer={<Button title="Save prices" icon="check" onPress={save} loading={busy} />}>
            <Group title="Price of one SMS" section="money" hint="A shop can have its own price (Shop → SMS wallet).">
                <NumberField label="You charge the shop" prefix="₹" value={f.rate} onChange={set('rate')} hint="Per SMS" />
                <NumberField label="It costs you" prefix="₹" value={f.cost} onChange={set('cost')} hint="Per SMS, from your provider" last />
                <View style={{ marginTop: spacing.md }}>
                    <Badge label={`Profit ₹${margin.toFixed(2)} per SMS`} tone={margin >= 0 ? 'success' : 'danger'} />
                </View>
            </Group>

            <Group title="Wallet" section="catalog">
                <NumberField label="Warn the owner below" prefix="₹" value={f.low} onChange={set('low')} />
                <NumberField label="Smallest top-up" prefix="₹" value={f.min} onChange={set('min')} />
                <NumberField label="Largest top-up" prefix="₹" value={f.max} onChange={set('max')} />
                <NumberField label="GST added on top of a top-up" value={f.gst} onChange={set('gst')} hint="Percent. The owner types the amount he wants in his balance and pays that plus this GST. Recommended: 18. 0 = no GST." last />
            </Group>

            <Group title="Top-up packs" section="shops" hint="Quick amounts shown to the owner (1 to 8).">
                {f.packs.map((p, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.sm }}>
                        <NumberField style={{ flex: 1 }} label={`Pack ${i + 1}`} prefix="₹" value={p} last onChange={(v) => setF((x) => ({ ...x, packs: x.packs.map((q, n) => (n === i ? (v ?? 0) : q)) }))} />
                        {f.packs.length > 1 ? (
                            <Pressable onPress={() => setF((x) => ({ ...x, packs: x.packs.filter((_, n) => n !== i) }))} hitSlop={8} style={{ height: 48, width: 44, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="trash" size={20} color={t.danger} />
                            </Pressable>
                        ) : null}
                    </View>
                ))}
                {f.packs.length < 8 ? <Button title="Add a pack" kind="soft" small icon="add" onPress={() => setF((x) => ({ ...x, packs: [...x.packs, 500] }))} /> : null}
                <Hint>Each pack must be at least ₹1.</Hint>
            </Group>
        </Screen>
    );
}
