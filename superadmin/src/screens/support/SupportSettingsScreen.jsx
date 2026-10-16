import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Loading, ErrorBox, toast } from '../../components/feedback';
import { fetchSupportSettings, saveSupportSettings } from '../../api/supportApi';
import { errMsg } from '../../api/adminClient';

// The contact card shop owners see under Help and support (their Call, WhatsApp and Email buttons, and when you answer).
export default function SupportSettingsScreen() {
    const nav = useNavigation();
    const [v, setV] = useState(null);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => { fetchSupportSettings().then(setV).catch((e) => setErr(errMsg(e))); }, []);
    if (!v) return <Screen title="Contact details">{err ? <ErrorBox message={err} /> : <Loading />}</Screen>;
    const set = (k, x) => setV((o) => ({ ...o, [k]: x }));

    const save = async () => {
        setSaving(true);
        try {
            await saveSupportSettings({ phone: v.phone, whatsapp: v.whatsapp, email: v.email, hours: v.hours, replyPromise: v.replyPromise });
            toast('Saved. Owners see this now.');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setSaving(false); }
    };

    return (
        <Screen title="Contact details" subtitle="What shop owners see" footer={<Button title="Save" icon="check" onPress={save} loading={saving} />}>
            <Card>
                <Field label="Support phone" value={v.phone} onChangeText={(x) => set('phone', x)} keyboardType="phone-pad" maxLength={20} placeholder="+91 98765 43210" hint="Owners get a Call button. Leave empty to hide it." />
                <Field label="WhatsApp number" value={v.whatsapp} onChangeText={(x) => set('whatsapp', x)} keyboardType="phone-pad" maxLength={20} placeholder="+91 98765 43210" hint="Owners get a WhatsApp button." />
                <Field label="Support email" value={v.email} onChangeText={(x) => set('email', x)} keyboardType="email-address" autoCapitalize="none" maxLength={120} placeholder="help@yourcompany.com" />
                <Field label="Support hours" value={v.hours} onChangeText={(x) => set('hours', x)} maxLength={120} placeholder="Mon to Sat, 10 AM to 7 PM" />
                <Field label="When you reply" value={v.replyPromise} onChangeText={(x) => set('replyPromise', x)} maxLength={160} placeholder="We reply within 24 hours." style={{ marginBottom: 0 }} />
            </Card>
        </Screen>
    );
}
