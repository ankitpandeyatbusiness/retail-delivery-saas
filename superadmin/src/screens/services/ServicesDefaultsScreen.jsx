import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button } from '../../components/ui';
import { Group, TextField, NumberField, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchServicesDefaults, saveServicesDefaults, resetServicesDefault } from '../../api/servicesApi';
import { errMsg } from '../../api/adminClient';

const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);

// What a new starter service begins with (the tap-to-fill texts for the customer, the quick replies for the owner), and when the owner is reminded
// about an inquiry nobody answered. Services the owners already made keep what they have; the questions of each kind can be changed through the API.
export default function ServicesDefaultsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [d, setD] = useState(null);
    const [hours, setHours] = useState(24);
    const [kinds, setKinds] = useState({});
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const fill = (r) => { setD(r); setHours(r.reminderHours); setKinds(Object.fromEntries(Object.entries(r.kinds).map(([k, v]) => [k, { texts: v.quickTexts.join('\n'), replies: v.quickReplies.join('\n') }]))); };
    const load = async () => { try { fill(await fetchServicesDefaults()); setErr(''); } catch (e) { setErr(errMsg(e)); } };
    useEffect(() => { load(); }, []);
    if (!d) return <Screen title="Services defaults">{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const set = (k, f) => (v) => setKinds((x) => ({ ...x, [k]: { ...x[k], [f]: v } }));
    const save = async () => {
        setBusy(true);
        try {
            fill(await saveServicesDefaults({ reminderHours: hours, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { quickTexts: lines(v.texts), quickReplies: lines(v.replies) }])) }));
            toast('Saved'); nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const reset = async (k) => { try { fill(await resetServicesDefault(k)); toast('Back to the built-in set'); } catch (e) { toast(errMsg(e), 'error'); } };

    return (
        <Screen title="Services defaults" subtitle="For new services only" footer={<Button title="Save" icon="check" onPress={save} loading={busy} />}>
            <Group title="Unanswered inquiries" section="platform" hint="The owner gets a reminder when a customer's message has waited this long.">
                <NumberField label="Remind the owner after (hours)" integer value={hours} onChange={(v) => setHours(v === undefined ? 24 : Math.round(v))} last />
            </Group>
            {Object.entries(d.kinds).map(([k, v]) => (
                <Group key={k} title={v.name} section="platform">
                    <TextField label="Tap-to-fill texts for the customer (one per line)" value={kinds[k]?.texts} onChange={set(k, 'texts')} multiline />
                    <TextField label="Quick replies for the owner (one per line)" value={kinds[k]?.replies} onChange={set(k, 'replies')} multiline last />
                    {v.changed ? <Button title="Back to the built-in set" kind="secondary" small onPress={() => reset(k)} style={{ marginTop: spacing.md }} /> : <Hint>Built-in set</Hint>}
                </Group>
            ))}
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>Services owners have already made are not changed. The owner's "Use recommended settings" button brings these back.</Text>
        </Screen>
    );
}
