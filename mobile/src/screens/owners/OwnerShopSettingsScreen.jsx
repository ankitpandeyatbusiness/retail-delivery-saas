// Shop settings: the phone customers and riders can call, the address, and whether the shop sends SMS alerts.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ToggleRow, Hint } from '../../components/owners/menuBits';
import { fetchSettings, saveSettings, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';

export default function OwnerShopSettingsScreen() {
    const nav = useNavigation();
    const access = useOwnerStore((s) => s.access);
    const [v, setV] = useState(null);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings().then((s) => setV({
            phone: s.phone || '', line: s.address.line || '', city: s.address.city || '', pincode: s.address.pincode || '',
            smsAlerts: s.notifications.smsAlerts !== false,
        })).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your settings.')); });
    }, []);

    if (!v) return <FormPage title="Shop settings">{err ? <Empty icon={access === 'ok' ? 'cloud-offline-outline' : 'lock-closed-outline'} title={access === 'ok' ? 'Could not load' : 'Locked while rent is unpaid'} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k, x) => setV((o) => ({ ...o, [k]: x }));

    const save = async () => {
        if (v.phone && !/^[6-9]\d{9}$/.test(v.phone)) { showToast('Enter a valid 10-digit mobile number'); return; }
        if (v.pincode && !/^\d{6}$/.test(v.pincode)) { showToast('Pincode is 6 digits'); return; }
        const body = { notifications: { smsAlerts: v.smsAlerts } };
        if (v.phone) body.phone = v.phone;
        body.address = { line: v.line, city: v.city, ...(v.pincode ? { pincode: v.pincode } : {}) };
        setSaving(true);
        try { await saveSettings(body); showToast('Saved'); nav.goBack(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    return (
        <FormPage title="Shop settings" footer={<Button label="Save" icon="checkmark" busy={saving} onPress={save} />}>
            <Group title="Contact" hint="Customers and riders call this number.">
                <TextBox label="Shop phone" value={v.phone} onChangeText={(x) => set('phone', x.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder="10-digit mobile number" last />
            </Group>
            <Group title="Address" hint="Shown to customers and on invoices.">
                <TextBox label="Street and area" value={v.line} onChangeText={(x) => set('line', x)} maxLength={150} multiline />
                <TextBox label="City" value={v.city} onChangeText={(x) => set('city', x)} maxLength={60} />
                <TextBox label="Pincode" value={v.pincode} onChangeText={(x) => set('pincode', x.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} last />
            </Group>
            <Group title="Alerts" hint="Each SMS is paid from your SMS balance.">
                <ToggleRow title="Important SMS alerts" subtitle="New orders, bills and order steps" value={v.smsAlerts} onValueChange={(x) => set('smsAlerts', x)} last />
            </Group>
            <Group title="Other settings">
                <Hint>Name, logo, colours and the app's look are set by the platform team. Contact support to change them.</Hint>
            </Group>
        </FormPage>
    );
}
