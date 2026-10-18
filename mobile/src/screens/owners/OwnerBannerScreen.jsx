// One banner: picture, words, an optional coupon code shown on it, and the dates it runs.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ChoiceBox, ToggleRow, DateBox, ImageField, Hint } from '../../components/owners/menuBits';
import { banners as bannersApi, coupons as couponsApi, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ymdOf, isoOfYmd } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const BLANK = { title: '', subtitle: '', image: '', couponCode: '', firstOrderOnly: false, startsAt: '', endsAt: '', isActive: true };

export default function OwnerBannerScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const [form, setForm] = useState(id ? null : BLANK);
    const [codes, setCodes] = useState([]);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        couponsApi.list({ limit: 100, active: 'true' }).then((r) => setCodes((r.items || []).map((c) => c.code))).catch(() => { });
        if (!id) return;
        bannersApi.get(id).then((r) => setForm({
            title: r.title || '', subtitle: r.subtitle || '', image: r.image || '', couponCode: r.couponCode || '',
            firstOrderOnly: !!r.firstOrderOnly, startsAt: ymdOf(r.startsAt), endsAt: ymdOf(r.endsAt), isActive: r.isActive !== false,
        })).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this banner.')); });
    }, [id]);

    if (!form) return <FormPage title={tr('Banner')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;
    const v = form;
    const set = (k, x) => setForm((f) => ({ ...f, [k]: x }));

    const save = async () => {
        if (!v.image && !v.title.trim()) { showToast(tr('Add a picture or a title')); return; }
        if ((v.startsAt && !/^\d{4}-\d{2}-\d{2}$/.test(v.startsAt)) || (v.endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(v.endsAt))) { showToast(tr('Type dates as 2026-11-01')); return; }
        if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) { showToast(tr('The end date cannot be before the start date')); return; }
        setSaving(true);
        const body = {
            title: v.title.trim(), subtitle: v.subtitle.trim(), image: v.image || '', couponCode: v.couponCode || '',
            firstOrderOnly: v.firstOrderOnly, startsAt: isoOfYmd(v.startsAt) ?? null, endsAt: isoOfYmd(v.endsAt, true) ?? null, isActive: v.isActive,
        };
        try {
            if (id) await bannersApi.update(id, body); else await bannersApi.create(body);
            showToast(id ? tr('Banner saved') : tr('Banner added'));
            nav.goBack();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const remove = async () => {
        const yes = await ask({ title: tr('Delete this banner?'), message: tr('It disappears from the home screen.'), confirmText: tr('Delete'), destructive: true });
        if (!yes) return;
        try { await bannersApi.remove(id); showToast(tr('Banner deleted')); nav.goBack(); }
        catch (e) { showToast(apiError(e)); }
    };

    return (
        <FormPage title={id ? tr('Edit banner') : tr('New banner')} footer={<Button label={id ? tr('Save changes') : tr('Add banner')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('Banner')} hint={tr('A wide picture works best, for example 1200 × 500.')}>
                <ImageField label={tr('Picture')} value={v.image} onChange={(x) => set('image', x)} kind="banner" />
                <TextBox label={tr('Title')} value={v.title} onChangeText={(x) => set('title', x)} maxLength={60} placeholder={tr('e.g. 20% off on sweets')} />
                <TextBox label={tr('Subtitle (optional)')} value={v.subtitle} onChangeText={(x) => set('subtitle', x)} maxLength={100} last />
            </Group>
            <Group title={tr('Coupon on the banner')} hint={tr('Optional. The code is shown on the banner so customers can use it.')}>
                {codes.length ? (
                    <ChoiceBox options={[['', tr('No code')], ...codes.map((c) => [c, c])]} value={v.couponCode} onChange={(x) => set('couponCode', x)} last />
                ) : <Hint>{tr('You have no active coupon yet. Add one under Coupons.')}</Hint>}
            </Group>
            <Group title={tr('Who sees it')}>
                <ToggleRow title={tr('New customers only')} subtitle={tr('Shown only to people who have not ordered yet')} value={v.firstOrderOnly} onValueChange={(x) => set('firstOrderOnly', x)} last />
            </Group>
            <Group title={tr('When')} hint={tr('Optional. Outside these dates the banner is hidden.')}>
                <DateBox label={tr('Starts on')} value={v.startsAt} onChange={(x) => set('startsAt', x)} />
                <DateBox label={tr('Ends on')} value={v.endsAt} onChange={(x) => set('endsAt', x)} last />
            </Group>
            <Group title={tr('Show it')}>
                <ToggleRow title={tr('Banner is on')} value={v.isActive} onValueChange={(x) => set('isActive', x)} last />
            </Group>
            {id ? <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label={tr('Delete this banner')} kind="danger" icon="trash" onPress={remove} /></View> : null}
        </FormPage>
    );
}
