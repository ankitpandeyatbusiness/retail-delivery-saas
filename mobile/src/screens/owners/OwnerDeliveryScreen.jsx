// Delivery area and fees: where the shop is on the map, how far it delivers, the smallest order, what the customer pays for
// delivery and packaging, the tip buttons, and how long an order usually takes. GST is set by the platform (shown only).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, NumberBox, ChoiceBox, Hint, Label } from '../../components/owners/menuBits';
import { PinMap } from '../../components/owners/pinMap';
import { fetchSettings, saveSettings, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { FEE_TYPES, feeText, feeProblem } from '../../utils/owners/settingsRules';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerDeliveryScreen() {
    const nav = useNavigation();
    const { text, muted, primary, border } = useBrand();
    const access = useOwnerStore((s) => s.access);
    const [v, setV] = useState(null);
    const [gst, setGst] = useState(null);
    const [pin, setPin] = useState(false);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings().then((s) => {
            const fee = s.orders.deliveryFee || {};
            setGst(s.orders.gst);
            setV({
                latitude: s.delivery.latitude, longitude: s.delivery.longitude, radiusKm: s.delivery.radiusKm,
                type: fee.type || 'free', amount: fee.amount, freeAbove: fee.freeAbove || undefined, baseKm: fee.baseKm, baseFee: fee.baseFee, perKmFee: fee.perKmFee, maxFee: fee.maxFee || undefined,
                packaging: s.orders.packagingCharge || 0, minOrder: s.orders.minOrder || 0, prepTimeMin: s.orders.prepTimeMin,
                tips: s.orders.tipOptions || [],
            });
        }).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your delivery settings.')); });
    }, []);

    if (!v) return <FormPage title={tr('Delivery area and fees')}>{err ? <Empty icon={access === 'ok' ? 'cloud-offline-outline' : 'lock-closed-outline'} title={access === 'ok' ? tr('Could not load') : tr('Locked while rent is unpaid')} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
    const pinned = Number.isFinite(v.latitude) && Number.isFinite(v.longitude);

    const save = async () => {
        const problem = feeProblem(v);
        if (problem) { showToast(problem); return; }
        const fee = { type: v.type };
        if (v.type === 'flat') fee.amount = v.amount ?? 0;
        if (v.type === 'distance') Object.assign(fee, { baseKm: v.baseKm ?? 0, baseFee: v.baseFee ?? 0, perKmFee: v.perKmFee ?? 0, maxFee: v.maxFee ?? 0 });
        fee.freeAbove = v.type === 'free' ? 0 : (v.freeAbove ?? 0);
        const body = {
            orders: { deliveryFee: fee, packagingCharge: v.packaging ?? 0, minOrder: v.minOrder ?? 0, tipOptions: v.tips, ...(v.prepTimeMin !== undefined ? { prepTimeMin: v.prepTimeMin } : {}) },
            delivery: { ...(pinned ? { latitude: v.latitude, longitude: v.longitude } : {}), ...(v.radiusKm !== undefined ? { radiusKm: v.radiusKm } : {}) },
        };
        setSaving(true);
        try { await saveSettings(body); showToast(tr('Saved. Customers see the new fees now.')); nav.goBack(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const tipsText = v.tips.join(', ');

    return (
        <FormPage title={tr('Delivery area and fees')} footer={<Button label={tr('Save')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('Where you deliver')}>
                <Pressable onPress={() => setPin(true)} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 14, padding: 12, marginBottom: 14 }}>
                    <Ionicons name="location" size={24} color={pinned ? primary : muted} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontWeight: '800' }}>{pinned ? tr('Shop is pinned on the map') : tr('Pin your shop on the map')}</Text>
                        <Text style={{ color: muted, fontSize: 12 }}>{pinned ? `${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}` : tr('Needed for delivery distance and fees')}</Text>
                    </View>
                    <Text style={{ color: primary, fontWeight: '800' }}>{pinned ? tr('Change') : tr('Set')}</Text>
                </Pressable>
                <NumberBox label={tr('How far you deliver')} suffix="km" value={v.radiusKm} onChange={(x) => set('radiusKm', x)} hint={tr('Straight-line distance from your shop.')} />
                <NumberBox label={tr('Smallest order')} prefix="₹" value={v.minOrder} onChange={(x) => set('minOrder', x)} last />
            </Group>

            <Group title={tr('Delivery fee')} hint={feeText(v.type === 'free' ? { type: 'free' } : { type: v.type, amount: v.amount, freeAbove: v.freeAbove, baseKm: v.baseKm, baseFee: v.baseFee, perKmFee: v.perKmFee, maxFee: v.maxFee })}>
                <ChoiceBox options={FEE_TYPES} value={v.type} onChange={(x) => set('type', x)} />
                {v.type === 'flat' ? <NumberBox label={tr('Delivery fee')} prefix="₹" value={v.amount} onChange={(x) => set('amount', x)} /> : null}
                {v.type === 'distance' ? (
                    <>
                        <NumberBox label={tr('Fee for the first kilometres')} prefix="₹" value={v.baseFee} onChange={(x) => set('baseFee', x)} />
                        <NumberBox label={tr('The first kilometres')} suffix="km" value={v.baseKm} onChange={(x) => set('baseKm', x)} hint={tr('Covered by the fee above.')} />
                        <NumberBox label={tr('Each extra km')} prefix="₹" value={v.perKmFee} onChange={(x) => set('perKmFee', x)} />
                        <NumberBox label={tr('Highest fee (optional)')} prefix="₹" value={v.maxFee} onChange={(x) => set('maxFee', x)} hint={tr('0 or empty = no limit')} />
                    </>
                ) : null}
                {v.type !== 'free' ? <NumberBox label={tr('Free delivery above (optional)')} prefix="₹" value={v.freeAbove} onChange={(x) => set('freeAbove', x)} hint={tr('Orders of this amount or more pay no delivery fee.')} last /> : <Hint>{tr('Customers pay nothing for delivery.')}</Hint>}
            </Group>

            <Group title={tr('Extra charges')}>
                <NumberBox label={tr('Packaging charge per order')} prefix="₹" value={v.packaging} onChange={(x) => set('packaging', x)} />
                <NumberBox label={tr('Usual time to prepare')} suffix="min" integer value={v.prepTimeMin} onChange={(x) => set('prepTimeMin', x)} hint={tr('Customers see this as the wait. Use Busy mode when you are rushed.')} last />
            </Group>

            <Group title={tr('Tip buttons')} hint={tr('Amounts the customer can give the rider. Up to 5, from ₹0 to ₹500. Empty = no tipping.')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {v.tips.map((t, i) => (
                        <Pressable key={`${t}-${i}`} onPress={() => set('tips', v.tips.filter((_, n) => n !== i))} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: border, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, marginBottom: 8 }}>
                            <Text style={{ color: text, fontWeight: '800' }}>₹{t}</Text><Ionicons name="close" size={16} color={muted} style={{ marginLeft: 6 }} />
                        </Pressable>
                    ))}
                </View>
                {v.tips.length < 5 ? <TipAdder onAdd={(n) => set('tips', [...v.tips, n].sort((a, b) => a - b))} /> : null}
            </Group>

            <Group title={tr('Tax (GST)')} hint={tr('Set by the platform. It is added to orders only if your shop has a GST number.')}>
                <Text style={{ color: text, fontWeight: '800' }}>{gst && gst.mode !== 'none' ? `${gst.percent}% (${gst.mode === 'inclusive' ? 'included in prices' : 'added on top'})` : tr('No GST is charged')}</Text>
            </Group>

            <PinMap visible={pin} initial={pinned ? { latitude: v.latitude, longitude: v.longitude } : null} radiusKm={v.radiusKm} onClose={() => setPin(false)} onPick={(c) => { set('latitude', c.latitude); set('longitude', c.longitude); setPin(false); }} />
        </FormPage>
    );
}

function TipAdder({ onAdd }) {
    const [x, setX] = useState(undefined);
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <NumberBox style={{ flex: 1 }} label={tr('Add a tip amount')} prefix="₹" integer value={x} onChange={setX} last />
            <View style={{ width: 10 }} />
            <Button label={tr('Add')} kind="ghost" onPress={() => { if (x === undefined || x > 500) { showToast(tr('A tip is from ₹0 to ₹500')); return; } onAdd(x); setX(undefined); }} />
        </View>
    );
}
