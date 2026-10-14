import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { spacing, font, useTheme } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Group, Choice, NumberField, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { platformTax, savePlatformTax } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';

const MODES = [
    { value: 'inclusive', label: 'Included in the prices' },
    { value: 'exclusive', label: 'Added on top' },
];

// The ONE GST rate for every shop's customer bills. Only you set it; a shop uses it only after you save its GST number.
export default function GstScreen() {
    const t = useTheme();
    const [f, setF] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { setF(await platformTax()); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!f) return <Screen title="GST on shop bills">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const save = async () => {
        setBusy(true);
        try {
            setF(await savePlatformTax({ gstPercent: Number(f.gstPercent) || 0, gstMode: f.gstMode }));
            toast('GST saved for every shop');
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const on = Number(f.gstPercent) > 0;
    return (
        <Screen title="GST on shop bills" subtitle="One rate for every shop" footer={<Button title="Save" icon="check" onPress={save} loading={busy} />}>
            <Group title="Rate" section="money" hint="This is the GST on the bills customers get from the shops. Shop owners cannot change it.">
                <NumberField label="GST" suffix="%" value={f.gstPercent} onChange={(v) => setF({ ...f, gstPercent: v ?? 0 })} hint="0 switches GST off everywhere" />
                <Choice label="How it is charged" options={MODES} value={f.gstMode} onChange={(v) => setF({ ...f, gstMode: v })} last />
            </Group>

            <Card style={{ marginTop: spacing.lg }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{on ? `${f.gstPercent}% ${f.gstMode === 'inclusive' ? 'included in prices' : 'added on top'}` : 'GST is off'}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>
                    {on
                        ? 'A shop charges it on every item only while you have saved that shop\'s GST number (Shops → the shop → Edit shop → GST number). Shops without a GST number charge no GST.'
                        : 'Customers are charged no GST in any shop until you set a rate.'}
                </Text>
            </Card>
            <Hint>Only you can save or change a shop's GST number. The owner sees the bill with GST but has no option to edit the rate or the number.</Hint>
        </Screen>
    );
}
