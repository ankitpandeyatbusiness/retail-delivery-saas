import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { spacing, font, useTheme } from '../../theme';
import { Screen } from '../../components/layout';
import { Button } from '../../components/ui';
import { Group, TextField, NumberField, Hint, Choice } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchSettlementConfig, saveSettlementConfig } from '../../api/settlementApi';
import { errMsg } from '../../api/adminClient';

const RECOMMENDED = { payDays: 15, ownerPctPartnerBrought: 50, ownerPctOwnerBrought: 70, costOwnerPct: 50, royaltyPct: 20, mode: 'split' };

// The names on the sheet, the ratios and the payment deadline. Only the supreme admin gets here. A change applies to rows made
// AFTER it; rows already on the sheet keep the ratio they were made with.
export default function SettlementSettingsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [f, setF] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => { try { setF(await fetchSettlementConfig()); setErr(''); } catch (e) { setErr(errMsg(e)); } };
    useEffect(() => { load(); }, []);
    if (!f) return <Screen title="Names and ratios">{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

    const save = async () => {
        setBusy(true);
        try {
            await saveSettlementConfig({
                ownerName: f.ownerName, partnerName: f.partnerName, payDays: f.payDays, ownerPctPartnerBrought: f.ownerPctPartnerBrought,
                ownerPctOwnerBrought: f.ownerPctOwnerBrought, costOwnerPct: f.costOwnerPct, royaltyPct: f.royaltyPct, mode: f.mode,
            });
            toast('Saved'); nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const int = (k) => (v) => set(k)(v === undefined ? 0 : Math.round(v));

    return (
        <Screen title="Names and ratios" subtitle="Applies to new rows" footer={<Button title="Save" icon="check" onPress={save} loading={busy} />}>
            <Group title="Names on the sheet" section="platform">
                <TextField label="The developer" value={f.ownerName} onChange={set('ownerName')} maxLength={40} />
                <TextField label="The agency (billing partner)" value={f.partnerName} onChange={set('partnerName')} maxLength={40} last />
            </Group>
            <Group title="Shop payments (rent, setup, SMS top-ups)" section="money" hint="The developer's share of the amount before GST. The rest is the agency's.">
                <NumberField label="Shop brought by the agency" suffix="% to the developer" value={f.ownerPctPartnerBrought} onChange={int('ownerPctPartnerBrought')} />
                <NumberField label="Shop brought by the developer" suffix="% to the developer" value={f.ownerPctOwnerBrought} onChange={int('ownerPctOwnerBrought')} last />
            </Group>
            <Group title="Shared costs" section="catalog" hint="SMS recharge, server, database, API and agreed extras.">
                <NumberField label="Developer's share of a shared cost" suffix="%" value={f.costOwnerPct} onChange={int('costOwnerPct')} last />
            </Group>
            <Group title="Payment deadline" section="orders">
                <NumberField label="The agency pays within" suffix="days of each payment" value={f.payDays} onChange={int('payDays')} last />
            </Group>
            <Group title="Royalty after exit" section="alerts" hint="Used only if the agreement ends: the developer then gets this share of net profit on every shop.">
                <NumberField label="Developer's royalty" suffix="% of net profit" value={f.royaltyPct} onChange={int('royaltyPct')} last />
            </Group>
            <Group title="Which rule applies now" section="alerts" hint="“Shared with the agency” is the normal setting (50/50 and 70/30). Choose “Royalty only” after the 60-day exit.">
                <Choice options={[{ value: 'split', label: 'Shared with the agency' }, { value: 'royalty', label: 'Royalty only (after exit)' }, { value: 'owner_only', label: 'Everything is mine' }]} value={f.mode} onChange={set('mode')} last />
            </Group>
            <Button title="Reset to recommended" kind="soft" icon="refresh" onPress={() => { setF((x) => ({ ...x, ...RECOMMENDED })); toast('Back to the recommended numbers. Press Save to keep them.'); }} />
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>Recommended: 50 / 50 on a partner's shop, 70 / 30 on yours, shared costs 50 / 50, 15 days.</Text>
            <Hint>Rows already on the sheet keep the ratio they were made with.</Hint>
        </Screen>
    );
}
