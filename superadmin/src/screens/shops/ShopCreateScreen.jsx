import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Choice, MultiChoice, NumberField, Hint, ReorderList, ColorField } from '../../components/settingsForm';
import AppPreview from '../../components/AppPreview';
import MapPicker from '../../components/MapPicker';
import { toast } from '../../components/feedback';
import { createShop, addOwner, fetchOptions } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopsStore } from '../../store/useShopsStore';
import { choices, nameOf } from '../../utils/settings';

const PHONE_RE = /^[6-9]\d{9}$/;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const STEPS = ['Basics', 'Location', 'Ordering', 'Design', 'Owner'];
const SWATCHES = ['#E8590C', '#D6336C', '#7048E8', '#1C7ED6', '#0CA678', '#2F9E44', '#F08C00', '#C92A2A', '#343A40'];

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

// New shop in 5 steps: basics, location (on the map), ordering rules, how the customer app looks, owner.
// Everything is built once here; each part can still be changed later under Shop → Customer app.
export default function ShopCreateScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [step, setStep] = useState(0);
    const [busy, setBusy] = useState(false);
    const [opts, setOpts] = useState(null);
    const [f, setF] = useState({
        name: '', slug: '', slugTouched: false, phone: '', line: '', city: '', pincode: '', ownerPhone: '',
        foodMode: 'mixed', types: ['delivery'], minOrder: 0, feeType: 'free', feeAmount: 0, freeAbove: 0,
        latitude: null, longitude: null, radiusKm: 5,
        primary: '#E8590C', fontStyle: 'modern', buttonShape: 'rounded', cardStyle: 'big',
        tabs: ['home', 'search', 'orders', 'profile'], blocks: null,
    });
    const [mapOpen, setMapOpen] = useState(false);
    const [err, setErr] = useState({});

    useEffect(() => { fetchOptions().then(setOpts).catch(() => { }); }, []);
    const preset = opts?.presets?.restaurant;   // the only business type open today: a restaurant
    const blocks = f.blocks || (preset?.blocks || []).map((b) => ({ type: b.type, enabled: b.enabled !== false }));

    const set = (k) => (v) => {
        setErr((e) => ({ ...e, [k]: undefined }));
        setF((p) => {
            const next = { ...p, [k]: v };
            if (k === 'name' && !p.slugTouched) next.slug = slugify(v);
            if (k === 'slug') next.slugTouched = true;
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
        if (step === 4 && f.ownerPhone && !PHONE_RE.test(f.ownerPhone)) e.ownerPhone = 'Enter a valid 10-digit number';
        setErr(e);
        return !Object.keys(e).length;
    };

    const next = () => { if (validate()) setStep((s) => s + 1); };

    const buildSettings = () => {
        const home = { shopType: 'restaurant', foodMode: f.foodMode, cardStyle: f.cardStyle };
        if (preset) {
            home.blocks = blocks;
            home.sortOptions = preset.sortOptions;   // filters stay automatic: only those with data show
            home.itemOptions = preset.itemOptions;
        }
        const deliveryFee = { type: f.feeType };
        if (f.feeType === 'flat' || f.feeType === 'free_above') deliveryFee.amount = f.feeAmount || 0;
        if (f.feeType === 'free_above') deliveryFee.freeAbove = f.freeAbove || 0;
        return {
            brand: { colors: { primary: f.primary }, fontStyle: f.fontStyle, buttonShape: f.buttonShape },
            tabs: f.tabs,
            home,
            orders: { types: f.types, minOrder: f.minOrder || 0, deliveryFee },
        };
    };

    const submit = async () => {
        if (!validate()) return;
        setBusy(true);
        try {
            const body = {
                slug: f.slug,
                businessType: 'restaurant',
                name: f.name.trim(),
                ...(f.phone ? { phone: f.phone } : {}),
                address: { line: f.line.trim(), city: f.city.trim(), pincode: f.pincode },
                ...(f.latitude != null ? { delivery: { latitude: f.latitude, longitude: f.longitude, radiusKm: f.radiusKm || 5 } } : {}),
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
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '700' }}>BUSINESS TYPE</Text>
                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', marginTop: 2 }}>Restaurant</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm }}>Food, sweets and drinks. More kinds of shops are coming.</Text>
                    </Card>
                    <Field label="Shop phone (optional)" value={f.phone} onChangeText={(v) => set('phone')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" error={err.phone} />
                </>
            ) : null}

            {step === 1 ? (
                <>
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>Where is the shop?</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2, marginBottom: spacing.md }}>
                            {f.latitude != null ? `Pinned at ${f.latitude}, ${f.longitude}` : 'Point to the shop on the Google map. Search a place, or use your current location.'}
                        </Text>
                        <Button title={f.latitude != null ? 'Change the pin' : 'Point on the map'} icon="pin" kind={f.latitude != null ? 'soft' : 'primary'} onPress={() => setMapOpen(true)} />
                    </Card>
                    <MapPicker
                        visible={mapOpen}
                        initial={f.latitude != null ? { latitude: f.latitude, longitude: f.longitude } : null}
                        onClose={() => setMapOpen(false)}
                        onPick={(p) => {
                            setF((x) => ({
                                ...x, latitude: p.latitude, longitude: p.longitude,
                                line: x.line || p.line || '', city: x.city || p.city || '', pincode: x.pincode || p.pincode || '',
                            }));
                            setMapOpen(false);
                        }}
                    />
                    <Field label="Address" value={f.line} onChangeText={set('line')} placeholder="Street, area" multiline />
                    <Field label="City" value={f.city} onChangeText={set('city')} />
                    <Field label="Pincode" value={f.pincode} onChangeText={(v) => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={err.pincode} />
                    <NumberField label="Delivery radius" suffix="km" value={f.radiusKm} onChange={(v) => set('radiusKm')(v ?? 5)} hint="How far from the pin this shop delivers" last />
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
                            <Hint>Hours, riders, payments and more are under Shop → Customer app after the shop is created.</Hint>
                        </>
                    ) : <Text style={{ color: t.muted }}>Loading options…</Text>}
                </Card>
            ) : null}

            {step === 3 ? (
                <>
                    <AppPreview name={f.name || 'Your shop'} primary={f.primary} tabs={f.tabs} blocks={blocks} cardStyle={f.cardStyle} shape={f.buttonShape} />
                    <Card style={{ marginTop: spacing.lg }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, marginBottom: spacing.sm }}>Main colour</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                            {SWATCHES.map((c) => (
                                <Pressable key={c} onPress={() => set('primary')(c)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c, borderWidth: 3, borderColor: f.primary === c ? t.text : 'transparent' }} />
                            ))}
                        </View>
                        <ColorField label="Or any colour" value={f.primary} onChange={(v) => set('primary')(v || '#E8590C')} last />
                    </Card>
                    <Card style={{ marginTop: spacing.md }}>
                        <Choice label="Font style" options={choices('font', opts?.options?.FONT_STYLES || [])} value={f.fontStyle} onChange={set('fontStyle')} />
                        <Choice label="Button shape" options={choices('shape', opts?.options?.BUTTON_SHAPES || [])} value={f.buttonShape} onChange={set('buttonShape')} />
                        <Choice label="Item cards" options={choices('cardStyle', opts?.options?.CARD_STYLES || [])} value={f.cardStyle} onChange={set('cardStyle')} last />
                    </Card>
                    <Card style={{ marginTop: spacing.md }}>
                        <MultiChoice label="Bottom tabs" hint="Home is always on. Pick 2 to 5." options={choices('tab', opts?.options?.TABS || [])} value={f.tabs} min={2} max={5} onChange={(v) => set('tabs')(v.includes('home') ? v : ['home', ...v])} last />
                    </Card>
                    <Card style={{ marginTop: spacing.md }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, marginBottom: spacing.sm }}>Home screen, top to bottom</Text>
                        <ReorderList
                            section="catalog"
                            items={blocks.map((b) => ({ key: b.type, label: nameOf('block', b.type), enabled: b.enabled, locked: b.type === 'items' }))}
                            onChange={(next) => set('blocks')(next.map((i) => ({ type: i.key, enabled: i.enabled !== false })))}
                        />
                        <Hint>A block with nothing to show (no banner, no offers yet) stays hidden by itself. Filters follow the menu automatically.</Hint>
                    </Card>
                </>
            ) : null}

            {step === 4 ? (
                <>
                    <Card style={{ marginBottom: spacing.lg }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{f.name}</Text>
                        <Text style={{ color: t.muted, marginTop: 2 }}>{f.slug} · Restaurant{f.latitude != null ? ' · on the map' : ''}</Text>
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
