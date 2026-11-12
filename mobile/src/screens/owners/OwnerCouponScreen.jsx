// One coupon: code, discount (percent or flat), when it works, how many times it can be used, who sees it.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, NumberBox, ChoiceBox, ToggleRow, DateBox, Hint } from '../../components/owners/menuBits';
import { coupons as couponsApi, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { couponProblem } from '../../utils/owners/hubRules';
import { ymdOf, isoOfYmd } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { Text } from 'react-native';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Hero, GlassStat } from '../../components/owners/RiderDesk';
import Masonry from '../../components/common/Masonry';
import { tr } from '../../i18n';

const BLANK = {
    code: '', description: '', discountType: 'percent', discountValue: undefined, maxDiscount: undefined, minOrder: undefined,
    firstOrderOnly: false, dineInOnly: false, usageLimitPerUser: 1, totalUsageLimit: undefined, isPublic: true, startsAt: '', endsAt: '', isActive: true,
};

export default function OwnerCouponScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner with a live ticket of the coupon, and the settings in two columns
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const [form, setForm] = useState(id ? null : BLANK);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!id) return;
        couponsApi.get(id).then((r) => setForm({
            code: r.code || '', description: r.description || '', discountType: r.discountType, discountValue: r.discountValue, maxDiscount: r.maxDiscount,
            minOrder: r.minOrder || undefined, firstOrderOnly: !!r.firstOrderOnly, dineInOnly: !!r.dineInOnly, usageLimitPerUser: r.usageLimitPerUser ?? 1, totalUsageLimit: r.totalUsageLimit,
            isPublic: r.isPublic !== false, startsAt: ymdOf(r.startsAt), endsAt: ymdOf(r.endsAt), isActive: r.isActive !== false,
        })).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this coupon.')); });
    }, [id]);

    if (!form) return <FormPage title={tr('Coupon')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;
    const v = form;
    const set = (k, x) => setForm((f) => ({ ...f, [k]: x }));

    const save = async () => {
        const problem = couponProblem(v);
        if (problem) { showToast(problem); return; }
        setSaving(true);
        const body = {
            code: v.code.trim().toUpperCase(), description: v.description.trim(), discountType: v.discountType, discountValue: v.discountValue,
            maxDiscount: v.discountType === 'percent' ? (v.maxDiscount ?? null) : null, minOrder: v.minOrder ?? 0,
            firstOrderOnly: v.firstOrderOnly, dineInOnly: v.dineInOnly, usageLimitPerUser: v.usageLimitPerUser ?? 1, totalUsageLimit: v.totalUsageLimit ?? null,
            isPublic: v.isPublic, startsAt: isoOfYmd(v.startsAt) ?? null, endsAt: isoOfYmd(v.endsAt, true) ?? null, isActive: v.isActive,
        };
        try {
            if (id) await couponsApi.update(id, body); else await couponsApi.create(body);
            showToast(id ? tr('Coupon saved') : tr('Coupon added'));
            nav.goBack();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const remove = async () => {
        const yes = await ask({ title: tr('Switch this coupon off for good?'), message: tr('Nobody can use it any more. Past orders keep their discount.'), confirmText: tr('Remove'), destructive: true });
        if (!yes) return;
        try { await couponsApi.remove(id); showToast(tr('Coupon removed')); nav.goBack(); }
        catch (e) { showToast(apiError(e)); }
    };

    return (
        <FormPage wide title={id ? tr('Edit coupon') : tr('New coupon')} footer={<Button label={id ? tr('Save changes') : tr('Add coupon')} icon="checkmark" busy={saving} onPress={save} />}>
            {desk ? (
                <Hero icon="pricetag" title={id ? tr('Edit coupon') : tr('New coupon')} subtitle={tr('Fill in the boxes. The ticket shows what your customers will see.')}>
                    <View style={{ flexDirection: 'row', alignItems: 'stretch', marginTop: 18 }}>
                        <View style={{ flexDirection: 'row', borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.95)', minWidth: 420 }}>
                            <View style={{ width: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.08)', paddingVertical: 18 }}>
                                <Text style={{ color: '#1A1A1A', fontWeight: '900', fontSize: 32, letterSpacing: -1 }}>{v.discountValue ? (v.discountType === 'percent' ? `${v.discountValue}%` : `₹${v.discountValue}`) : '—'}</Text>
                                <Text style={{ color: '#1A1A1A', fontWeight: '900', fontSize: 12, letterSpacing: 1.5 }}>{tr('OFF')}</Text>
                            </View>
                            <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
                                <Text style={{ color: '#1A1A1A', fontWeight: '900', fontSize: 22, letterSpacing: 3 }}>{v.code || tr('YOURCODE')}</Text>
                                <Text style={{ color: '#555555', marginTop: 3, fontSize: 13.5 }}>{v.description || tr('Your note appears here')}</Text>
                                <Text style={{ color: '#555555', marginTop: 4, fontSize: 12.5, fontWeight: '700' }}>{[v.minOrder ? tr('Orders from ₹{n}', { n: v.minOrder }) : '', v.discountType === 'percent' && v.maxDiscount ? tr('Up to ₹{n} off', { n: v.maxDiscount }) : '', v.firstOrderOnly ? tr('First order only') : '', v.dineInOnly ? tr('Dine in only') : ''].filter(Boolean).join(' · ') || tr('On every order')}</Text>
                            </View>
                        </View>
                        <GlassStat label={tr('Starts')} value={v.startsAt || tr('Right away')} icon="calendar-outline" />
                        <GlassStat label={tr('Ends')} value={v.endsAt || tr('Never')} icon="flag-outline" />
                    </View>
                </Hero>
            ) : null}
            <Masonry desk={desk} gap={-16}>
            <Group icon="pricetag" title={tr('Code')}>
                <TextBox label={tr('Code customers type')} value={v.code} onChangeText={(x) => set('code', x.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} maxLength={20} placeholder={tr('e.g. FIRST50')} />
                <TextBox label={tr('Note (optional)')} value={v.description} onChangeText={(x) => set('description', x)} maxLength={120} placeholder={tr('e.g. Welcome offer')} last />
            </Group>
            <Group icon="cash" title={tr('Discount')}>
                <ChoiceBox label={tr('Type')} options={[['percent', tr('Percent off')], ['flat', tr('Rupees off')]]} value={v.discountType} onChange={(x) => set('discountType', x)} />
                <NumberBox label={v.discountType === 'percent' ? tr('Percent') : tr('Amount')} prefix={v.discountType === 'flat' ? '₹' : undefined} suffix={v.discountType === 'percent' ? '%' : undefined} value={v.discountValue} onChange={(x) => set('discountValue', x)} />
                {v.discountType === 'percent' ? <NumberBox label={tr('Highest discount (optional)')} prefix="₹" value={v.maxDiscount} onChange={(x) => set('maxDiscount', x)} hint={tr('Stops a big order from getting a big discount.')} /> : null}
                <NumberBox label={tr('Smallest order (optional)')} prefix="₹" value={v.minOrder} onChange={(x) => set('minOrder', x)} last />
            </Group>
            <Group icon="people" title={tr('Who and how often')}>
                <ToggleRow title={tr('First order only')} subtitle={tr('Only customers who never ordered before')} value={v.firstOrderOnly} onValueChange={(x) => set('firstOrderOnly', x)} />
                <ToggleRow title={tr('Only for Dine In')} subtitle={tr('Shown and used only on dine in orders')} value={v.dineInOnly} onValueChange={(x) => set('dineInOnly', x)} />
                <View style={{ height: 12 }} />
                <NumberBox label={tr('Times one customer can use it')} integer value={v.usageLimitPerUser} onChange={(x) => set('usageLimitPerUser', x)} />
                <NumberBox label={tr('Total uses allowed (optional)')} integer value={v.totalUsageLimit} onChange={(x) => set('totalUsageLimit', x)} last />
            </Group>
            <Group icon="calendar" title={tr('When')} hint={tr('Optional. Outside these dates the code does not work.')}>
                <DateBox label={tr('Starts on')} value={v.startsAt} onChange={(x) => set('startsAt', x)} />
                <DateBox label={tr('Ends on')} value={v.endsAt} onChange={(x) => set('endsAt', x)} last />
            </Group>
            <Group icon="eye" title={tr('Show it')}>
                <ToggleRow title={tr('Show in the app')} subtitle={tr('Off: only people who know the code can use it')} value={v.isPublic} onValueChange={(x) => set('isPublic', x)} />
                <ToggleRow title={tr('Coupon is on')} value={v.isActive} onValueChange={(x) => set('isActive', x)} last />
            </Group>
            </Masonry>
            {id ? <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label={tr('Remove this coupon')} kind="danger" icon="trash" onPress={remove} /></View> : null}
        </FormPage>
    );
}
