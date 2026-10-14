import React, { useState } from 'react';
import { useRoute } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card, KeyValue } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, Choice, NumberField, Switch, Hint } from '../../components/settingsForm';
import { DateField } from '../../components/catalogBits';
import { Loading, ErrorBox, ConfirmSheet } from '../../components/feedback';
import useRecordForm from '../../hooks/useRecordForm';
import { ymdOf, isoOfYmd } from '../../utils/format';

const BLANK = {
    code: '', description: '', discountType: 'percent', discountValue: undefined, maxDiscount: undefined, minOrder: 0,
    firstOrderOnly: false, usageLimitPerUser: 1, totalUsageLimit: undefined, isPublic: true, startsAt: '', endsAt: '', isActive: true,
};

export default function CouponFormScreen() {
    const { shopId, name: shopName, id } = useRoute().params;
    const [confirmOff, setConfirmOff] = useState(false);

    const f = useRecordForm({
        shopId, resource: 'coupons', id, blank: BLANK,
        fromRecord: (r) => ({
            code: r.code || '', description: r.description || '', discountType: r.discountType || 'percent',
            discountValue: r.discountValue, maxDiscount: r.maxDiscount, minOrder: r.minOrder || 0,
            firstOrderOnly: !!r.firstOrderOnly, usageLimitPerUser: r.usageLimitPerUser ?? 1, totalUsageLimit: r.totalUsageLimit,
            isPublic: r.isPublic !== false, startsAt: ymdOf(r.startsAt), endsAt: ymdOf(r.endsAt), isActive: r.isActive !== false,
        }),
        validate: (v) => {
            const e = {};
            if (!v.code.trim()) e.code = 'Enter the coupon code';
            if (v.discountValue === undefined || v.discountValue <= 0) e.discountValue = 'Enter the discount';
            if (v.discountType === 'percent' && v.discountValue > 100) e.discountValue = 'A percent coupon cannot be more than 100';
            if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) e.endsAt = 'The end date cannot be before the start date';
            return e;
        },
        toBody: (v) => ({
            code: v.code.trim().toUpperCase(),
            description: v.description.trim(),
            discountType: v.discountType,
            discountValue: v.discountValue,
            maxDiscount: v.discountType === 'percent' ? (v.maxDiscount ?? null) : null,
            minOrder: v.minOrder || 0,
            firstOrderOnly: v.firstOrderOnly,
            usageLimitPerUser: v.usageLimitPerUser || 1,
            totalUsageLimit: v.totalUsageLimit ?? null,
            isPublic: v.isPublic,
            startsAt: isoOfYmd(v.startsAt) ?? null,
            endsAt: isoOfYmd(v.endsAt, true) ?? null,
            isActive: v.isActive,
        }),
        label: id ? 'Coupon saved' : 'Coupon added',
    });

    if (!f.form) return <Screen title="Coupon" subtitle={shopName}>{f.error ? <ErrorBox message={f.error} onRetry={f.reload} /> : <Loading />}</Screen>;
    const v = f.form;
    const percent = v.discountType === 'percent';

    return (
        <Screen
            title={f.isNew ? 'New coupon' : 'Edit coupon'}
            subtitle={shopName}
            footer={<Button title={f.isNew ? 'Add coupon' : 'Save changes'} icon="check" onPress={f.save} loading={f.saving} />}
        >
            <Card>
                <Field label="Coupon code" value={v.code} onChangeText={(x) => f.set('code', x.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" maxLength={20} placeholder="e.g. FIRST50" error={f.errors.code} />
                <Field label="Description (optional)" value={v.description} onChangeText={(x) => f.set('description', x)} maxLength={120} placeholder="Shown with the coupon" />
                {!f.isNew && f.record ? <KeyValue label="Times used" value={String(f.record.usedCount || 0)} last /> : null}
            </Card>

            <Group title="Discount" section="money">
                <Choice
                    options={[{ value: 'percent', label: 'Percent off' }, { value: 'flat', label: 'Flat amount off' }]}
                    value={v.discountType}
                    onChange={(x) => f.set('discountType', x)}
                />
                <NumberField label={percent ? 'Percent' : 'Amount'} prefix={percent ? undefined : '₹'} suffix={percent ? '%' : undefined} value={v.discountValue} onChange={(x) => f.set('discountValue', x)} hint={f.errors.discountValue} />
                {percent ? <NumberField label="Highest discount (optional)" prefix="₹" value={v.maxDiscount} onChange={(x) => f.set('maxDiscount', x)} hint="Caps a percent coupon, e.g. 20% off up to ₹100" /> : null}
                <NumberField label="Minimum order" prefix="₹" value={v.minOrder} onChange={(x) => f.set('minOrder', x ?? 0)} last />
            </Group>

            <Group title="Limits" section="alerts">
                <NumberField label="Uses per customer" integer value={v.usageLimitPerUser} onChange={(x) => f.set('usageLimitPerUser', x ?? 1)} />
                <NumberField label="Total uses (optional)" integer value={v.totalUsageLimit} onChange={(x) => f.set('totalUsageLimit', x)} hint="Empty = no limit" />
                <Switch title="First order only" subtitle="Only for customers who never ordered" value={v.firstOrderOnly} onValueChange={(x) => f.set('firstOrderOnly', x)} last />
            </Group>

            <Group title="When" section="orders" hint="Optional.">
                <DateField label="Starts on" value={v.startsAt} onChange={(x) => f.set('startsAt', x)} />
                <DateField label="Ends on" value={v.endsAt} onChange={(x) => f.set('endsAt', x)} last />
                {f.errors.endsAt ? <Hint tone="warn">{f.errors.endsAt}</Hint> : null}
            </Group>

            <Group title="Show it" section="riders" flush>
                <Switch title="Shown to customers" subtitle="Off = a secret code: it works only if the customer types it" value={v.isPublic} onValueChange={(x) => f.set('isPublic', x)} />
                <Switch title="Active" subtitle="Switch off to stop the coupon" value={v.isActive} onValueChange={(x) => f.set('isActive', x)} last />
            </Group>

            {!f.isNew ? <Button title="Switch this coupon off" kind="dangerSoft" icon="block" style={{ marginTop: spacing.xl }} onPress={() => setConfirmOff(true)} /> : null}
            <ConfirmSheet
                visible={confirmOff}
                onClose={() => setConfirmOff(false)}
                title="Switch this coupon off?"
                message="Customers can no longer use it. Orders that already used it are not affected."
                confirmLabel="Switch off"
                danger
                onConfirm={f.remove}
            />
        </Screen>
    );
}
