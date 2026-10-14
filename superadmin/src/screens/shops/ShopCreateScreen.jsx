import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Chip, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Choice, MultiChoice, NumberField, Hint } from '../../components/settingsForm';
import { toast } from '../../components/feedback';
import { createShop, addOwner, fetchOptions } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopsStore } from '../../store/useShopsStore';
import { titleCase } from '../../utils/format';
import { choices } from '../../utils/settings';

const PHONE_RE = /^[6-9]\d{9}$/;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const STEPS = ['Basics', 'Location', 'App', 'Owner'];

function Steps({ index }) {
    const t = useTheme();
    return (
        <View style={{ flexDirection: 'row', marginBottom: spacing.xl }}>
            {STEPS.map((s, i) => (
                <View key={s} style={{ flex: 1, marginRight: i < STEPS.length - 1 ? spacing.sm : 0 }}>
                    <View style={{ height: 5, borderRadius: 3, backgroundColor: i <= index ? t.primary : t.border }} />
                    <Text style={{ color: i === index ? t.text : t.muted, fontSize: font.xs, fontWeight: '800', marginTop: 6 }}>{`${i + 1}. ${s}`}</Text>
                </View>
            ))}
        </View>
    );
}

// New shop in 4 steps. Step 3 starts the customer app from the shop type's template, so the shop is usable at once;
// everything can be changed later under Shop → Customer app.
export default function ShopCreateScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [step, setStep] = useState(0);
    const [busy, setBusy] = useState(false);
    const [opts, setOpts] = useState(null);
    const [f, setF] = useState({
        name: '', slug: '', slugTouched: false, shopType: '', phone: '', line: '', city: '', pincode: '', ownerPhone: '',
        foodMode: 'mixed', types: ['delivery'], minOrder: 0, feeType: 'free', feeAmount: 0, freeAbove: 0,
    });
    const [err, setErr] = useState({});

    useEffect(() => { fetchOptions().then(setOpts).catch(() => { }); }, []);
    const types = opts?.options?.SHOP_TYPES || [];
    const preset = opts?.presets?.[f.shopType];

    const set = (k) => (v) => {
        setErr((e) => ({ ...e, [k]: undefined }));
        setF((p) => {
            const next = { ...p, [k]: v };
            if (k === 'name' && !p.slugTouched) next.slug = slugify(v);
            if (k === 'slug') next.slugTouched = true;
            if (k === 'shopType' && opts?.presets?.[v]) next.foodMode = opts.presets[v].foodMode;   // start from the template's food mode
            return next;
        });
    };

    const validate = () => {
        const e = {};
        if (step === 0) {
            if (f.name.trim().length < 2) e.name = 'Enter the shop name';
            if (!SLUG_RE.test(f.slug)) e.slug = '3–40 characters: small letters, numbers and hyphens';
            if (f.phone && !PHONE_RE.test(f.phone)) e.phone = 'Enter a valid 10-digit number';
        }
        if (step === 1 && f.pincode && !/^\d{6}$/.test(f.pincode)) e.pincode = 'Pincode is 6 digits';
        if (step === 3 && f.ownerPhone && !PHONE_RE.test(f.ownerPhone)) e.ownerPhone = 'Enter a valid 10-digit number';
        setErr(e);
        return !Object.keys(e).length;
    };

    const next = () => { if (validate()) setStep((s) => s + 1); };

    const buildSettings = () => {
        const home = { ...(f.shopType ? { shopType: f.shopType } : {}), foodMode: f.foodMode };
        if (preset) {
            home.blocks = preset.blocks;
            home.filters = preset.filters;
            home.sortOptions = preset.sortOptions;
            home.cardStyle = preset.cardStyle;
            home.itemOptions = preset.itemOptions;
        }
        const deliveryFee = { type: f.feeType };
        if (f.feeType === 'flat' || f.feeType === 'free_above') deliveryFee.amount = f.feeAmount || 0;
        if (f.feeType === 'free_above') deliveryFee.freeAbove = f.freeAbove || 0;
        return { home, orders: { types: f.types, minOrder: f.minOrder || 0, deliveryFee } };
    };

    const submit = async () => {
        if (!validate()) return;
        setBusy(true);
        try {
            const body = {
                slug: f.slug,
                name: f.name.trim(),
                ...(f.phone ? { phone: f.phone } : {}),
                address: { line: f.line.trim(), city: f.city.trim(), pincode: f.pincode },
                settings: buildSettings(),
            };
            const { tenant } = await createShop(body);
            useShopsStore.getState().add({ ...tenant, state: { acceptingOrders: true, reasons: [] } });
            let ownerOk = true;
            if (f.ownerPhone) {
                try { await addOwner(tenant._id, f.ownerPhone); } catch (e) { ownerOk = false; toast(`Shop created, but owner not added: ${errMsg(e)}`, 'error'); }
            }
            if (ownerOk) toast('Shop created');
            nav.replace('ShopDetail', { shopId: tenant._id, name: tenant.name });
        } catch (e) {
            const m = errMsg(e);
            if (/slug/i.test(m) || /duplicate|exists/i.test(m)) { setErr({ slug: m }); setStep(0); } else toast(m, 'error');
            setBusy(false);
        }
    };

    const last = step === STEPS.length - 1;
    return (
        <Screen
            title="New shop"
            subtitle={`Step ${step + 1} of ${STEPS.length}`}
            footer={
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    {step > 0 ? <Button title="Back" kind="outline" onPress={() => setStep(step - 1)} style={{ flex: 1 }} disabled={busy} /> : null}
                    <Button title={last ? 'Create shop' : 'Continue'} onPress={last ? submit : next} loading={busy} style={{ flex: 2 }} />
                </View>
            }
        >
            <Steps index={step} />

            {step === 0 ? (
                <>
                    <Field label="Shop name" value={f.name} onChangeText={set('name')} placeholder="e.g. Savera Sweets" error={err.name} autoFocus />
                    <Field
                        label="Shop code (slug)"
                        value={f.slug}
                        onChangeText={(v) => set('slug')(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        autoCapitalize="none"
                        hint="Built into this shop's app. It cannot be changed later."
                        error={err.slug}
                    />
                    <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700', marginBottom: 8 }}>Shop type</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg }}>
                        {types.map((ty) => (
                            <View key={ty} style={{ marginBottom: spacing.sm }}>
                                <Chip label={titleCase(ty)} active={f.shopType === ty} onPress={() => set('shopType')(ty)} />
                            </View>
                        ))}
                    </View>
                    <Field label="Shop phone (optional)" value={f.phone} onChangeText={(v) => set('phone')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" error={err.phone} />
                </>
            ) : null}

            {step === 1 ? (
                <>
                    <Field label="Address" value={f.line} onChangeText={set('line')} placeholder="Street, area" multiline />
                    <Field label="City" value={f.city} onChangeText={set('city')} />
                    <Field label="Pincode" value={f.pincode} onChangeText={(v) => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={err.pincode} />
                </>
            ) : null}

            {step === 2 ? (
                <Card>
                    {opts ? (
                        <>
                            <Choice label="Food" options={choices('foodMode', opts.options.FOOD_MODES)} value={f.foodMode} onChange={set('foodMode')} />
                            <MultiChoice label="How customers get orders" options={choices('orderType', opts.options.ORDER_TYPES)} value={f.types} min={1} onChange={set('types')} />
                            <NumberField label="Minimum order" prefix="₹" value={f.minOrder} onChange={(v) => set('minOrder')(v ?? 0)} />
                            <Choice label="Delivery fee" options={choices('fee', (opts.options.FEE_TYPES || []).filter((x) => x !== 'distance'))} value={f.feeType} onChange={set('feeType')} last={f.feeType === 'free'} />
                            {f.feeType === 'flat' || f.feeType === 'free_above' ? <NumberField label="Fee" prefix="₹" value={f.feeAmount} onChange={(v) => set('feeAmount')(v ?? 0)} last={f.feeType === 'flat'} /> : null}
                            {f.feeType === 'free_above' ? <NumberField label="Free for orders above" prefix="₹" value={f.freeAbove} onChange={(v) => set('freeAbove')(v ?? 0)} last /> : null}
                            <Hint>
                                {preset
                                    ? `The home screen starts from the ${titleCase(f.shopType)} template. Tabs, colours, hours, riders and more are under Shop → Customer app.`
                                    : 'Pick a shop type in step 1 to start from its template. Everything is editable later under Shop → Customer app.'}
                            </Hint>
                        </>
                    ) : <Text style={{ color: t.muted }}>Loading options…</Text>}
                </Card>
            ) : null}

            {step === 3 ? (
                <>
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{f.name}</Text>
                        <Text style={{ color: t.muted, marginTop: 2 }}>{f.slug}{f.shopType ? ` · ${titleCase(f.shopType)}` : ''}</Text>
                        <Text style={{ color: t.muted, marginTop: 2 }}>
                            {choices('foodMode', [f.foodMode])[0].label} · {f.types.map((x) => choices('orderType', [x])[0].label).join(', ')}
                        </Text>
                    </Card>
                    <Field
                        label="Owner mobile number (optional)"
                        value={f.ownerPhone}
                        onChangeText={(v) => set('ownerPhone')(v.replace(/\D/g, '').slice(0, 10))}
                        keyboardType="number-pad"
                        hint="The owner logs in to the shop panel with this number and an OTP. You can add owners later too."
                        error={err.ownerPhone}
                    />
                </>
            ) : null}
        </Screen>
    );
}
