import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Field, ToggleRow } from '../../components/inputs';
import { Loading, ErrorBox, toast } from '../../components/feedback';
import { fetchInsightsSettings, saveInsightsSettings } from '../../api/reportApi';
import { errMsg } from '../../api/adminClient';

const RECOMMENDED = { showMarketplaceCompare: true, marketplaceCommissionPct: 25, monthlyReportEmail: true, autopilotEnabled: true };

// How the progress report is presented to shop owners. The recommended settings are shown; Reset puts them back.
export default function InsightsSettingsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [v, setV] = useState(null);
    const [pct, setPct] = useState('25');
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    const apply = (x) => { setV(x); setPct(String(x.marketplaceCommissionPct)); };
    useEffect(() => { fetchInsightsSettings().then(apply).catch((e) => setErr(errMsg(e))); }, []);
    if (!v) return <Screen title="Report settings">{err ? <ErrorBox message={err} /> : <Loading />}</Screen>;

    const save = async () => {
        const n = Number(pct);
        if (!Number.isFinite(n) || n < 0 || n > 60) { toast('The commission is a number from 0 to 60', 'error'); return; }
        setSaving(true);
        try { apply(await saveInsightsSettings({ showMarketplaceCompare: v.showMarketplaceCompare, monthlyReportEmail: v.monthlyReportEmail, autopilotEnabled: v.autopilotEnabled, marketplaceCommissionPct: n })); toast('Saved'); nav.goBack(); }
        catch (e) { toast(errMsg(e), 'error'); } finally { setSaving(false); }
    };
    const reset = () => { setV({ ...v, ...RECOMMENDED }); setPct(String(RECOMMENDED.marketplaceCommissionPct)); toast('Back to the recommended settings. Press Save to keep them.'); };

    return (
        <Screen title="Report settings" subtitle="What owners see in their progress report" footer={<Button title="Save" icon="check" onPress={save} loading={saving} />}>
            <Card>
                <ToggleRow title="Monthly report email" subtitle="On the 1st, every shop gets last month's report in the app and by email with a PDF. Recommended: on." value={v.monthlyReportEmail} onValueChange={(x) => setV({ ...v, monthlyReportEmail: x })} />
                <ToggleRow title="Show the marketplace comparison" subtitle="'What the same orders would cost on a delivery marketplace'. Always labelled an estimate. Recommended: on." value={v.showMarketplaceCompare} onValueChange={(x) => setV({ ...v, showMarketplaceCompare: x })} />
                <ToggleRow title="Autopilot reminders" subtitle="The kill switch: off stops every shop's automatic reminders to its customers (push and inbox). Recommended: on." value={v.autopilotEnabled !== false} onValueChange={(x) => setV({ ...v, autopilotEnabled: x })} last />
            </Card>
            <Card style={{ marginTop: spacing.md }}>
                <Field label="Marketplace commission used for that estimate (%)" value={pct} onChangeText={(x) => setPct(x.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" maxLength={5} hint="Recommended: 25. Use a number you can defend; owners compare it with what they know." style={{ marginBottom: 0 }} />
            </Card>
            <Button title="Reset to recommended" kind="soft" icon="refresh" onPress={reset} />
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>The estimate is only a comparison. Sales, orders, customers and ratings in the report are the shop's real numbers.</Text>
        </Screen>
    );
}
