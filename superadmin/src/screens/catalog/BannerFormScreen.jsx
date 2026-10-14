import React, { useState } from 'react';
import { useRoute } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, NumberField, Switch, Hint } from '../../components/settingsForm';
import { ImageField, DateField } from '../../components/catalogBits';
import { Loading, ErrorBox, ConfirmSheet } from '../../components/feedback';
import useRecordForm from '../../hooks/useRecordForm';
import { ymdOf, isoOfYmd } from '../../utils/format';

const BLANK = { title: '', subtitle: '', image: '', couponCode: '', firstOrderOnly: false, startsAt: '', endsAt: '', sortOrder: 0, isActive: true };

export default function BannerFormScreen() {
    const { shopId, name: shopName, id } = useRoute().params;
    const [confirmDel, setConfirmDel] = useState(false);

    const f = useRecordForm({
        shopId, resource: 'banners', id, blank: BLANK,
        fromRecord: (r) => ({
            title: r.title || '', subtitle: r.subtitle || '', image: r.image || '', couponCode: r.couponCode || '',
            firstOrderOnly: !!r.firstOrderOnly, startsAt: ymdOf(r.startsAt), endsAt: ymdOf(r.endsAt),
            sortOrder: r.sortOrder || 0, isActive: r.isActive !== false,
        }),
        validate: (v) => {
            const e = {};
            if (!v.title.trim() && !v.image) e.title = 'Add a title or a picture';
            if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) e.endsAt = 'The end date cannot be before the start date';
            return e;
        },
        toBody: (v) => ({
            title: v.title.trim(), subtitle: v.subtitle.trim(), image: v.image || '',
            couponCode: v.couponCode.trim().toUpperCase(), firstOrderOnly: v.firstOrderOnly,
            startsAt: isoOfYmd(v.startsAt) ?? null, endsAt: isoOfYmd(v.endsAt, true) ?? null,
            sortOrder: v.sortOrder || 0, isActive: v.isActive,
        }),
        label: id ? 'Banner saved' : 'Banner added',
    });

    if (!f.form) return <Screen title="Banner" subtitle={shopName}>{f.error ? <ErrorBox message={f.error} onRetry={f.reload} /> : <Loading />}</Screen>;
    const v = f.form;

    return (
        <Screen
            title={f.isNew ? 'New banner' : 'Edit banner'}
            subtitle={shopName}
            footer={<Button title={f.isNew ? 'Add banner' : 'Save changes'} icon="check" onPress={f.save} loading={f.saving} />}
        >
            <Card>
                <ImageField label="Banner picture" value={v.image} onChange={(x) => f.set('image', x)} shopId={shopId} kind="banner" />
                <Field label="Title" value={v.title} onChangeText={(x) => f.set('title', x)} error={f.errors.title} maxLength={60} placeholder="e.g. Flat 20% off" />
                <Field label="Subtitle (optional)" value={v.subtitle} onChangeText={(x) => f.set('subtitle', x)} maxLength={100} />
                <Field label="Coupon code shown on it (optional)" value={v.couponCode} onChangeText={(x) => f.set('couponCode', x.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" maxLength={20} placeholder="e.g. FIRST50" hint="Make sure a coupon with this code exists (Coupons)." />
                <Switch title="Show to first-time customers only" value={v.firstOrderOnly} onValueChange={(x) => f.set('firstOrderOnly', x)} last />
            </Card>

            <Group title="When" section="orders" hint="Optional. Outside these dates the banner is not shown.">
                <DateField label="Starts on" value={v.startsAt} onChange={(x) => f.set('startsAt', x)} />
                <DateField label="Ends on" value={v.endsAt} onChange={(x) => f.set('endsAt', x)} last />
                {f.errors.endsAt ? <Hint tone="warn">{f.errors.endsAt}</Hint> : null}
            </Group>

            <Group title="Show it" section="riders" flush>
                <Switch title="Visible to customers" value={v.isActive} onValueChange={(x) => f.set('isActive', x)} last />
            </Group>
            <Group title="Position" section="catalog">
                <NumberField label="Order in the banner strip" integer hint="Smaller numbers come first" value={v.sortOrder} onChange={(x) => f.set('sortOrder', x ?? 0)} last />
            </Group>

            {!f.isNew ? <Button title="Delete this banner" kind="dangerSoft" icon="trash" style={{ marginTop: spacing.xl }} onPress={() => setConfirmDel(true)} /> : null}
            <ConfirmSheet
                visible={confirmDel}
                onClose={() => setConfirmDel(false)}
                title="Delete this banner?"
                message="It is removed for good."
                confirmLabel="Delete"
                danger
                onConfirm={f.remove}
            />
        </Screen>
    );
}
