// Delivery rules: how riders are picked, how many orders at once, what a delivery pays, the PIN check, live tracking, and the
// cash-on-delivery limit for a customer's first orders. Closed while rent is unpaid (the server says so).
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, NumberBox, ChoiceBox, ToggleRow, Hint } from '../../components/owners/menuBits';
import { fetchSettings, saveSettings, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';

// what we recommend for most shops (the platform's own defaults)
const RECOMMENDED = { assignMode: 'automatic', offerSeconds: 120, maxActiveOrders: 3, payPerDelivery: 0, deliveryPin: true, liveTracking: true, locationIntervalSec: 10, codAmount: 1000, codFirst: 3 };

export default function OwnerRiderRulesScreen() {
    const nav = useNavigation();
    const access = useOwnerStore((s) => s.access);
    const [form, setForm] = useState(null);
    const [err, setErr] = useState('');
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        fetchSettings().then((s) => alive && setForm({ ...s.riders, codAmount: s.orders.codCap.amount, codFirst: s.orders.codCap.firstOrders }))
            .catch((e) => { useOwnerStore.getState().noteError(e); if (alive) setErr(apiError(e, 'Could not load your delivery rules.')); });
        return () => { alive = false; };
    }, []);

    const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };
    const reset = () => { setForm((f) => ({ ...f, ...RECOMMENDED })); setErrors({}); showToast('Back to the recommended rules. Press Save to keep them.'); };

    if (!form) {
        return (
            <FormPage title="Delivery rules">
                {err ? <Empty icon={access === 'ok' ? 'cloud-offline-outline' : 'lock-closed-outline'} title={access === 'ok' ? 'Could not load' : 'Locked while rent is unpaid'} hint={err} /> : <FormShimmer />}
            </FormPage>
        );
    }
    const v = form;

    const save = async () => {
        const e = {};
        if (!(v.offerSeconds >= 30 && v.offerSeconds <= 600)) e.offerSeconds = 'From 30 to 600 seconds';
        if (!(v.maxActiveOrders >= 1 && v.maxActiveOrders <= 10)) e.maxActiveOrders = 'From 1 to 10';
        if (v.payPerDelivery === undefined || v.payPerDelivery < 0 || v.payPerDelivery > 10000) e.payPerDelivery = 'From 0 to 10000';
        if (!(v.locationIntervalSec >= 5 && v.locationIntervalSec <= 60)) e.locationIntervalSec = 'From 5 to 60 seconds';
        if (v.codAmount === undefined || v.codAmount < 0 || v.codAmount > 100000) e.codAmount = 'From 0 to 100000';
        if (v.codFirst === undefined || v.codFirst < 0 || v.codFirst > 50) e.codFirst = 'From 0 to 50';
        if (Object.keys(e).length) { setErrors(e); showToast(Object.values(e)[0]); return; }
        setSaving(true);
        try {
            await saveSettings({
                riders: {
                    assignMode: v.assignMode, offerSeconds: v.offerSeconds, maxActiveOrders: v.maxActiveOrders, payPerDelivery: v.payPerDelivery,
                    deliveryPin: v.deliveryPin, liveTracking: v.liveTracking, locationIntervalSec: v.locationIntervalSec,
                },
                orders: { codCap: { amount: v.codAmount, firstOrders: v.codFirst } },
            });
            showToast('Delivery rules saved');
            nav.goBack();
        } catch (er) { useOwnerStore.getState().noteError(er); showToast(apiError(er)); } finally { setSaving(false); }
    };

    return (
        <FormPage title="Delivery rules" footer={<Button label="Save rules" icon="checkmark" busy={saving} onPress={save} />}>
            <Group title="Giving orders to riders">
                <ChoiceBox
                    label="How is a rider picked"
                    options={[['automatic', 'Automatic'], ['manual', 'I choose']]}
                    value={v.assignMode}
                    onChange={(x) => set('assignMode', x)}
                />
                <Hint>{v.assignMode === 'automatic' ? 'The next free rider is asked by himself. If he does not answer, the next one is asked.' : 'Orders wait until you pick a rider on the order page.'}</Hint>
                <View style={{ height: 14 }} />
                {v.assignMode === 'automatic' ? (
                    <NumberBox label="Time a rider has to answer" suffix="seconds" integer value={v.offerSeconds} onChange={(x) => set('offerSeconds', x)} error={errors.offerSeconds} />
                ) : null}
                <NumberBox label="Orders one rider can carry at once" integer value={v.maxActiveOrders} onChange={(x) => set('maxActiveOrders', x)} error={errors.maxActiveOrders} />
                <NumberBox label="Pay for each delivery" prefix="₹" value={v.payPerDelivery} onChange={(x) => set('payPerDelivery', x)} error={errors.payPerDelivery} hint="Shown to the rider as what he earns. 0 = not shown." last />
            </Group>

            <Group title="At the customer's door">
                <ToggleRow title="Delivery PIN" subtitle="The customer tells the rider a PIN to confirm the delivery" value={v.deliveryPin} onValueChange={(x) => set('deliveryPin', x)} last />
            </Group>

            <Group title="Live tracking">
                <ToggleRow title="Customer sees the rider on a map" value={v.liveTracking} onValueChange={(x) => set('liveTracking', x)} last={!v.liveTracking} />
                {v.liveTracking ? (
                    <View style={{ marginTop: 14 }}>
                        <NumberBox label="Rider sends his location every" suffix="seconds" integer value={v.locationIntervalSec} onChange={(x) => set('locationIntervalSec', x)} error={errors.locationIntervalSec} hint="A smaller number is smoother but uses more of his battery and data." last />
                    </View>
                ) : null}
            </Group>

            <Group title="Cash on delivery limit" hint="A new customer can pay cash only up to this amount on his first orders. Then cash is open to him.">
                <NumberBox label="Highest cash order for a new customer" prefix="₹" value={v.codAmount} onChange={(x) => set('codAmount', x)} error={errors.codAmount} hint="0 = no limit" />
                <NumberBox label="Applies to his first" suffix="orders" integer value={v.codFirst} onChange={(x) => set('codFirst', x)} error={errors.codFirst} last />
            </Group>
            <View style={{ paddingHorizontal: 16, marginTop: 4 }}><Button label="Reset to recommended" icon="refresh" kind="ghost" onPress={reset} /></View>
        </FormPage>
    );
}
