// The rules of bulk orders: on/off, the two minimums, the delivery fee of bulk orders, the advance. (The bulk price of each dish is set on the dish.)
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, NumberBox, ChoiceBox, ToggleRow, Hint } from '../../components/owners/menuBits';
import { FormShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { bulk as api, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import Masonry from '../../components/common/Masonry';
import { tr } from '../../i18n';

export default function OwnerBulkSettingsScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner with the key numbers, and the rules in two columns
    const nav = useNavigation();
    const { muted, primary } = useBrand();
    const [v, setV] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { api.settings().then(setV).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load.')); }); }, []);

    if (!v) return <FormPage title={tr('Bulk order rules')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k) => (x) => setV((a) => ({ ...a, [k]: x }));
    const fee = v.deliveryFee || { type: 'free' };
    const setFee = (k) => (x) => setV((a) => ({ ...a, deliveryFee: { ...a.deliveryFee, [k]: x } }));

    // fills the form with the numbers the server recommends (it does not touch the on/off switch); he still taps Save
    const recommend = () => {
        if (!v.recommended) return;
        setV((a) => ({ ...a, ...a.recommended, deliveryFee: { ...a.deliveryFee, ...a.recommended.deliveryFee } }));
        showToast(tr('Recommended settings filled in. Tap Save.'));
    };

    const save = async () => {
        if (v.enabled && !v.pickup && !v.delivery) return showToast(tr('Allow pickup, delivery or both'));
        const body = {
            enabled: v.enabled, paused: !!v.paused, pickup: v.pickup, delivery: v.delivery,
            ...Object.fromEntries(['minOrderAmount', 'noticeHours', 'maxQtyPerDish', 'packagingCharge', 'advancePercent', 'quoteValidHours', 'fullRefundHours'].filter((k) => v[k] !== undefined).map((k) => [k, v[k]])),
            deliveryFee: Object.fromEntries(['type', 'amount', 'freeAbove', 'baseKm', 'baseFee', 'perKmFee', 'maxFee'].filter((k) => fee[k] !== undefined).map((k) => [k, fee[k]])),
        };
        setBusy(true);
        try { setV(await api.saveSettings(body)); showToast(tr('Saved')); nav.goBack(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <FormPage wide title={tr('Bulk order rules')} footer={<Button label={tr('Save')} icon="checkmark" busy={busy} onPress={save} />}>
            {desk ? (
                <Hero icon="cube" title={tr('Bulk order rules')} subtitle={tr('When customers can ask for a large order, what it costs and how the advance works.')}
                    right={<HeroBtn label={tr('Use recommended settings')} icon="sparkles-outline" solid onPress={recommend} />}>
                    <View style={{ flexDirection: 'row', marginTop: 18 }}>
                        <GlassStat label={tr('Bulk orders')} value={v.paused ? tr('Paused') : v.enabled ? tr('On') : tr('Off')} icon="power-outline" />
                        <GlassStat label={tr('Minimum order')} value={v.minOrder ? `₹${v.minOrder}` : '—'} icon="cash-outline" />
                        <GlassStat label={tr('Most of one dish')} value={v.maxQtyPerDish ? String(v.maxQtyPerDish) : '—'} icon="albums-outline" />
                        <GlassStat label={tr('Quote valid')} value={v.quoteValidHours ? tr('{n} hours', { n: v.quoteValidHours }) : '—'} icon="time-outline" />
                    </View>
                </Hero>
            ) : null}
            {desk ? null : <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                <Button label={tr('Use recommended settings')} icon="sparkles-outline" kind="ghost" onPress={recommend} />
            </View>}
            <Masonry desk={desk} gap={-16}>
            <Group icon="power" title={tr('Bulk orders')}>
                <ToggleRow title={tr('Take bulk orders')} subtitle={tr('Customers see Bulk order in Services and send you a request.')} value={!!v.enabled} onValueChange={set('enabled')} />
                <ToggleRow title={tr('Pause bulk orders')} subtitle={tr('Customers still see Bulk order, marked "temporarily unavailable", and cannot send a new request. Orders already taken carry on.')} value={!!v.paused} onValueChange={set('paused')} />
                <ToggleRow title={tr('Pickup')} value={!!v.pickup} onValueChange={set('pickup')} />
                <ToggleRow title={tr('Delivery')} value={!!v.delivery} onValueChange={set('delivery')} last />
            </Group>
            <Group icon="remove-circle" title={tr('Minimums')}>
                <NumberBox label={tr('Minimum order')} hint={tr('The least a bulk order may cost, after the bulk prices. 0 = no minimum.')} prefix="₹" value={v.minOrderAmount} onChange={set('minOrderAmount')} />
                <NumberBox label={tr('Notice needed')} hint={tr('How many hours before the pickup or delivery time it must be asked.')} integer suffix={tr('hours')} value={v.noticeHours} onChange={set('noticeHours')} />
                <NumberBox label={tr('Most pieces of one dish')} integer value={v.maxQtyPerDish} onChange={set('maxQtyPerDish')} last />
            </Group>
            <Group icon="bicycle" title={tr('Delivery fee for bulk orders')} hint={tr('Separate from the delivery fee of normal orders. You can still change it in each quote.')}>
                <ChoiceBox options={[['free', tr('Free')], ['flat', tr('Same for all')], ['free_above', tr('Free above an amount')], ['distance', tr('By distance')]]} value={fee.type} onChange={setFee('type')} />
                {fee.type === 'flat' || fee.type === 'free_above' ? <NumberBox label={tr('Delivery fee')} prefix="₹" value={fee.amount} onChange={setFee('amount')} /> : null}
                {fee.type === 'free_above' || fee.type === 'distance' ? <NumberBox label={tr('Free when the order is above')} hint={tr('0 = never free')} prefix="₹" value={fee.freeAbove} onChange={setFee('freeAbove')} /> : null}
                {fee.type === 'distance' ? (
                    <>
                        <NumberBox label={tr('Fee for the first km')} prefix="₹" value={fee.baseFee} onChange={setFee('baseFee')} />
                        <NumberBox label={tr('First km covered by that fee')} suffix="km" value={fee.baseKm} onChange={setFee('baseKm')} />
                        <NumberBox label={tr('Extra fee for every further km')} prefix="₹" value={fee.perKmFee} onChange={setFee('perKmFee')} />
                        <NumberBox label={tr('Highest fee')} hint={tr('0 = no limit')} prefix="₹" value={fee.maxFee} onChange={setFee('maxFee')} />
                    </>
                ) : null}
                <NumberBox label={tr('Packaging charge')} prefix="₹" value={v.packagingCharge} onChange={set('packagingCharge')} last />
            </Group>
            <Group icon="document-text" title={tr('Quote and advance')}>
                <NumberBox label={tr('Advance to confirm')} hint={tr('What the customer pays when he accepts your quote. The rest is paid on delivery or pickup.')} suffix="%" value={v.advancePercent} onChange={set('advancePercent')} />
                <NumberBox label={tr('A quote stays valid for')} integer suffix={tr('hours')} value={v.quoteValidHours} onChange={set('quoteValidHours')} />
                <NumberBox label={tr('Full refund if cancelled before')} hint={tr('If the customer cancels at least this long before the time, the whole advance goes back. Later, you keep it.')} integer suffix={tr('hours')} value={v.fullRefundHours} onChange={set('fullRefundHours')} last />
            </Group>
            </Masonry>
            {desk ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 4, padding: 16, borderRadius: 18, backgroundColor: muted + '1A' }}>
                    <Ionicons name="information-circle" size={22} color={primary} style={{ marginRight: 12 }} />
                    <Text style={{ flex: 1, color: muted, fontSize: 13.5, lineHeight: 20 }}>{tr('The bulk price of each dish (for example 10 percent off from 30 pieces) is set on the dish, in Menu.')}</Text>
                </View>
            ) : <Hint>{tr('The bulk price of each dish (for example 10 percent off from 30 pieces) is set on the dish, in Menu.')}</Hint>}
            <View style={{ height: 8 }}><Text style={{ color: muted }} /></View>
        </FormPage>
    );
}
