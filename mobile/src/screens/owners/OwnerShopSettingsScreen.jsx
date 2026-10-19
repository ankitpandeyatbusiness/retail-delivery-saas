// Shop settings: the phone customers and riders can call, the address, and whether the shop sends SMS alerts.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapPicker from '../../components/customers/MapPicker';
import { useBrand } from '../../components/common/kit';
import { useNavigation } from '@react-navigation/native';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ToggleRow, Hint } from '../../components/owners/menuBits';
import { fetchSettings, saveSettings, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerShopSettingsScreen() {
    const nav = useNavigation();
    const access = useOwnerStore((s) => s.access);
    const [v, setV] = useState(null);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);
    const [pin, setPin] = useState(false);
    const [pinMoved, setPinMoved] = useState(false);   // only a pin placed in THIS visit is sent, so a newer pin from the superadmin is never overwritten by an old one
    const { text, muted, primary, border } = useBrand();

    useEffect(() => {
        fetchSettings().then((s) => setV({
            latitude: s.delivery?.latitude, longitude: s.delivery?.longitude,
            phone: s.phone || '', line: s.address.line || '', city: s.address.city || '', state: s.address.state || '', pincode: s.address.pincode || '',
            showSoldOut: s.menu?.outOfStock !== 'hide',
            smsAlerts: s.notifications.smsAlerts !== false, monthlyReport: s.notifications.monthlyReport !== false,
        })).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your settings.')); });
    }, []);

    if (!v) return <FormPage title={tr('Shop settings')}>{err ? <Empty icon={access === 'ok' ? 'cloud-offline-outline' : 'lock-closed-outline'} title={access === 'ok' ? tr('Could not load') : tr('Locked while rent is unpaid')} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
    const pinned = Number.isFinite(v.latitude) && Number.isFinite(v.longitude);
    // a new pin fills the address below too, so the pin and the written address always change together
    const onPinned = (c) => {
        setV((o) => ({
            ...o, latitude: c.latitude, longitude: c.longitude,
            line: c.line1 || c.address || o.line, city: c.city || o.city, state: c.state || o.state, pincode: c.pincode || o.pincode,
        }));
        setPinMoved(true);
        setPin(false);
    };

    const save = async () => {
        if (v.phone && !/^[6-9]\d{9}$/.test(v.phone)) { showToast(tr('Enter a valid 10-digit mobile number')); return; }
        if (v.pincode && !/^\d{6}$/.test(v.pincode)) { showToast(tr('Pincode is 6 digits')); return; }
        const body = { notifications: { smsAlerts: v.smsAlerts, monthlyReport: v.monthlyReport }, menu: { outOfStock: v.showSoldOut ? 'dim' : 'hide' } };
        if (v.phone) body.phone = v.phone;
        if (pinMoved && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) body.delivery = { latitude: v.latitude, longitude: v.longitude };
        body.address = { line: v.line, city: v.city, state: v.state, ...(v.pincode ? { pincode: v.pincode } : {}) };
        setSaving(true);
        try { await saveSettings(body); showToast(tr('Saved')); nav.goBack(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    return (
        <FormPage title={tr('Shop settings')} footer={<Button label={tr('Save')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('Contact')} hint={tr('Customers and riders call this number.')}>
                <TextBox label={tr('Shop phone')} value={v.phone} onChangeText={(x) => set('phone', x.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" maxLength={10} placeholder={tr('10-digit mobile number')} last />
            </Group>
            <Group title={tr('Address')} hint={tr('Shown to customers and on invoices.')}>
                <Pressable onPress={() => setPin(true)} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 14, padding: 12, marginBottom: 14 }}>
                    <Ionicons name="location" size={24} color={pinned ? primary : muted} />
                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={{ color: text, fontWeight: '800' }}>{pinned ? tr('Shop is pinned on the map') : tr('Pin your shop on the map')}</Text>
                        <Text style={{ color: muted, fontSize: 12 }}>{pinned ? tr('Pin again and the address below is filled in for you') : tr('Needed for delivery distance and fees. Fills the address below.')}</Text>
                    </View>
                    <Text style={{ color: primary, fontWeight: '800' }}>{pinned ? tr('Change') : tr('Set')}</Text>
                </Pressable>
                <TextBox label={tr('Street and area')} value={v.line} onChangeText={(x) => set('line', x)} maxLength={150} multiline />
                <TextBox label={tr('City')} value={v.city} onChangeText={(x) => set('city', x)} maxLength={60} />
                <TextBox label={tr('State')} value={v.state} onChangeText={(x) => set('state', x)} maxLength={40} placeholder={tr('e.g. Uttar Pradesh')} hint={tr('Needed for the tax on your bills')} />
                <TextBox label={tr('Pincode')} value={v.pincode} onChangeText={(x) => set('pincode', x.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} last />
            </Group>
            <Group title={tr('Menu')} hint={tr('The platform team can change this too. The last change wins.')}>
                <ToggleRow title={tr('Show sold-out dishes')} subtitle={tr('ON: a dish you switch off stays on the menu, greyed out, with when it is back. OFF: it disappears from the menu until you switch it on.')} value={v.showSoldOut} onValueChange={(x) => set('showSoldOut', x)} last />
            </Group>
            <Group title={tr('Alerts and reports')} hint={tr('Recommended: both on.')}>
                <ToggleRow title={tr('Important SMS alerts')} subtitle={tr('New orders, bills and order steps. Each SMS is paid from your SMS balance.')} value={v.smsAlerts} onValueChange={(x) => set('smsAlerts', x)} />
                <ToggleRow title={tr('Monthly report')} subtitle={tr('On the 1st we send last month\'s progress report to your email and the app')} value={v.monthlyReport} onValueChange={(x) => set('monthlyReport', x)} last />
                <View style={{ marginTop: 12 }}><Button label={tr('Reset to recommended')} icon="refresh" kind="ghost" onPress={() => { setV((o) => ({ ...o, smsAlerts: true, monthlyReport: true })); showToast(tr('Back to the recommended settings. Press Save to keep them.')); }} /></View>
            </Group>
            <Group title={tr('Other settings')}>
                <Hint>{tr('Name, logo, colours and the app\'s look are set by the platform team. Contact support to change them.')}</Hint>
            </Group>
            <MapPicker forShop visible={pin} initial={pinned ? { latitude: v.latitude, longitude: v.longitude } : null} onClose={() => setPin(false)} onPick={onPinned} />
        </FormPage>
    );
}
