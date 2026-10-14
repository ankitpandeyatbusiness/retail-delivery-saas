import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import { Button } from '../../components/ui';
import { Group, TextField, ColorField, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchPlatform, saveBusiness } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';

const FIELDS = ['legalName', 'address', 'gstin', 'email', 'phone', 'sacCode', 'paymentInstructions', 'appName', 'brandColor', 'logoUrl'];

// YOUR business details: printed on every rent invoice and used in the mails sent to shops.
export default function PlatformBusinessScreen() {
    const nav = useNavigation();
    const [f, setF] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            const r = await fetchPlatform();
            setF(Object.fromEntries(FIELDS.map((k) => [k, r.business?.[k] || ''])));
            setError('');
        } catch (e) { setError(errMsg(e)); }
    };
    useEffect(() => { load(); }, []);

    if (!f) return <Screen title="Business details">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

    const save = async () => {
        const gst = f.gstin.trim().toUpperCase();
        if (gst && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) { toast('GST number must be 15 characters, like 22AAAAA0000A1Z5', 'error'); return; }
        if (f.logoUrl && !/^https:\/\/\S+$/.test(f.logoUrl)) { toast('The logo link must start with https://', 'error'); return; }
        setBusy(true);
        try {
            const body = Object.fromEntries(FIELDS.map((k) => [k, k === 'gstin' ? gst : f[k].trim()]));
            await saveBusiness(body);
            toast('Business details saved');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Business details" subtitle="Printed on every invoice" footer={<Button title="Save details" icon="check" onPress={save} loading={busy} />}>
            <Group title="Who you are" section="platform">
                <TextField label="Legal name" value={f.legalName} onChange={set('legalName')} maxLength={120} placeholder="e.g. Retail Control Technologies" />
                <TextField label="Address" value={f.address} onChange={set('address')} maxLength={250} multiline />
                <TextField label="Email" value={f.email} onChange={set('email')} maxLength={120} autoCapitalize="none" keyboardType="email-address" />
                <TextField label="Phone" value={f.phone} onChange={set('phone')} maxLength={20} keyboardType="phone-pad" last />
            </Group>
            <Group title="Tax" section="money" hint="GST is added to invoices only when a GST number is saved here.">
                <TextField label="GST number" value={f.gstin} onChange={(v) => set('gstin')(v.toUpperCase())} maxLength={15} autoCapitalize="characters" />
                <TextField label="SAC code" value={f.sacCode} onChange={set('sacCode')} maxLength={10} keyboardType="number-pad" last />
                <Hint>Ask your accountant which SAC code applies to your service.</Hint>
            </Group>
            <Group title="How shops pay you" section="catalog" hint="Printed on pending invoices.">
                <TextField label="Payment instructions" value={f.paymentInstructions} onChange={set('paymentInstructions')} maxLength={500} multiline placeholder="UPI id, bank account and IFSC..." last />
            </Group>
            <Group title="Mails" section="shops" hint="Used in the header of mails sent to shops.">
                <TextField label="App name" value={f.appName} onChange={set('appName')} maxLength={60} />
                <ColorField label="Brand colour" value={f.brandColor || undefined} onChange={(v) => set('brandColor')(v || '')} />
                <TextField label="Logo link (https)" value={f.logoUrl} onChange={set('logoUrl')} maxLength={300} autoCapitalize="none" keyboardType="url" last />
            </Group>
        </Screen>
    );
}
