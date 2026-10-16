import { isState } from '../../utils/states';
import React, { useEffect, useState } from 'react';
import { Text, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card, SectionTitle } from '../../components/ui';
import { Field, Segmented } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import MapPicker from '../../components/MapPicker';
import { toast, ConfirmSheet } from '../../components/feedback';
import { updateShop } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { useShopsStore } from '../../store/useShopsStore';

const str = (v) => (v === undefined || v === null ? '' : String(v));
const numOrUndef = (v) => (v === '' ? undefined : Number(v));
const decimal = (v) => v.replace(/[^\d.\-]/g, '');
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// Everything about the shop itself: contact, address, where it is on the map, delivery, tax numbers, rent GST, status.
export default function ShopEditScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const [f, setF] = useState(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [err, setErr] = useState({});
    const [busy, setBusy] = useState(false);
    const [confirmStatus, setConfirmStatus] = useState(false);

    useEffect(() => {
        if (rec && !f) {
            const x = rec.tenant;
            setF({
                name: str(x.name), tagline: str(x.tagline), phone: str(x.phone),
                line: str(x.address?.line), city: str(x.address?.city), state: str(x.address?.state), pincode: str(x.address?.pincode),
                minOrder: str(x.delivery?.minOrder), radiusKm: str(x.delivery?.radiusKm),
                latitude: str(x.delivery?.latitude), longitude: str(x.delivery?.longitude),
                legalName: str(x.business?.legalName), gstin: str(x.business?.gstin), fssai: str(x.business?.fssai),
                billingEmail: str(x.contact?.billingEmail),
                androidPackage: str(x.androidPackage),
                gstPercent: str(x.subscription?.gstPercent), startMonth: str(x.subscription?.startMonth),
                status: x.status || 'active',
            });
        }
    }, [rec, f]);

    if (!f) return <Screen title="Edit shop"><SkeletonList count={3} avatar={false} /></Screen>;
    const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v })); setErr((e) => ({ ...e, [k]: undefined })); };
    const orig = rec.tenant;

    const check = () => {
        const e = {};
        if (f.name.trim().length < 2) e.name = 'Shop name is needed';
        if (f.phone && !/^[6-9]\d{9}$/.test(f.phone)) e.phone = 'Enter a valid 10-digit number';
        if (f.pincode && !/^\d{6}$/.test(f.pincode)) e.pincode = 'Pincode is 6 digits';
        if (f.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.toUpperCase())) e.gstin = 'GST number must be 15 characters, like 22AAAAA0000A1Z5';
        if (f.fssai && !/^\d{14}$/.test(f.fssai)) e.fssai = 'FSSAI number is 14 digits';
        if (f.billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.billingEmail)) e.billingEmail = 'Enter a valid email';
        if (f.minOrder !== '' && !(Number(f.minOrder) >= 0)) e.minOrder = 'Enter an amount';
        if (f.radiusKm !== '' && !(Number(f.radiusKm) > 0)) e.radiusKm = 'Enter a distance in km';
        if (f.latitude !== '' && !(Number(f.latitude) >= -90 && Number(f.latitude) <= 90)) e.latitude = 'Latitude is between -90 and 90';
        if (f.longitude !== '' && !(Number(f.longitude) >= -180 && Number(f.longitude) <= 180)) e.longitude = 'Longitude is between -180 and 180';
        if ((f.latitude === '') !== (f.longitude === '')) e.latitude = 'Enter both latitude and longitude';
        if (f.androidPackage && !PACKAGE_RE.test(f.androidPackage)) e.androidPackage = 'Use small letters and dots, like com.mycompany.shopname';
        if (f.gstPercent !== '' && !(Number(f.gstPercent) >= 0 && Number(f.gstPercent) <= 28)) e.gstPercent = 'GST is between 0 and 28';
        if (f.startMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(f.startMonth)) e.startMonth = 'Use the form 2026-10';
        setErr(e);
        return !Object.keys(e).length;
    };

    // send only what changed. `business` replaces the whole object, so its three fields always go together.
    const save = async () => {
        if (!check()) return;
        const body = {};
        if (f.name.trim() !== str(orig.name)) body.name = f.name.trim();
        if (f.tagline !== str(orig.tagline)) body.tagline = f.tagline.trim();
        if (f.phone !== str(orig.phone)) body.phone = f.phone;
        if (f.status !== (orig.status || 'active')) body.status = f.status;
        if (f.androidPackage !== str(orig.androidPackage)) body.androidPackage = f.androidPackage.trim();
        if (f.line !== str(orig.address?.line) || f.city !== str(orig.address?.city) || f.state !== str(orig.address?.state) || f.pincode !== str(orig.address?.pincode)) {
            body.address = { line: f.line.trim(), city: f.city.trim(), state: f.state.trim(), pincode: f.pincode };
        }
        const dChanged = ['minOrder', 'radiusKm', 'latitude', 'longitude'].filter((k) => f[k] !== str(orig.delivery?.[k]));
        if (dChanged.length) {
            body.delivery = {};
            for (const k of dChanged) {
                if (f[k] === '' && k !== 'minOrder') continue;   // an empty box leaves the old value alone
                body.delivery[k] = numOrUndef(f[k]) ?? 0;
            }
        }
        if (f.legalName !== str(orig.business?.legalName) || f.gstin !== str(orig.business?.gstin) || f.fssai !== str(orig.business?.fssai)) {
            body.business = { legalName: f.legalName.trim(), gstin: f.gstin.trim().toUpperCase(), fssai: f.fssai.trim() };
        }
        if (f.billingEmail !== str(orig.contact?.billingEmail)) body.contact = { billingEmail: f.billingEmail.trim().toLowerCase() };
        if (f.gstPercent !== str(orig.subscription?.gstPercent) || f.startMonth !== str(orig.subscription?.startMonth)) {
            body.subscription = {};
            if (f.gstPercent !== str(orig.subscription?.gstPercent) && f.gstPercent !== '') body.subscription.gstPercent = Number(f.gstPercent);
            if (f.startMonth !== str(orig.subscription?.startMonth) && f.startMonth !== '') body.subscription.startMonth = f.startMonth;
            if (!Object.keys(body.subscription).length) delete body.subscription;
        }
        if (!Object.keys(body).length) { toast('Nothing changed'); return; }

        setBusy(true);
        try {
            const r = await updateShop(shopId, body);
            useShopStore.getState().setTenant(shopId, r.tenant);
            useShopStore.getState().load(shopId, { quiet: true });   // the state badge is worked out on the server
            useShopsStore.getState().patch(shopId, { name: r.tenant.name, status: r.tenant.status });
            toast('Saved');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const hasPoint = f.latitude !== '' && f.longitude !== '' && !err.latitude;

    return (
        <Screen title="Edit shop" footer={<Button title="Save changes" icon="check" onPress={save} loading={busy} />}>
            <SectionTitle section="shops">Shop</SectionTitle>
            <Card>
                <Field label="Shop name" value={f.name} onChangeText={set('name')} error={err.name} />
                <Field label="Tagline" value={f.tagline} onChangeText={set('tagline')} />
                <Field label="Phone" value={f.phone} onChangeText={(v) => set('phone')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" error={err.phone} style={{ marginBottom: 0 }} />
            </Card>

            <SectionTitle section="orders">Address</SectionTitle>
            <Card>
                <Field label="Address" value={f.line} onChangeText={set('line')} multiline />
                <Field label="City" value={f.city} onChangeText={set('city')} />
                <Field label="State" value={f.state} onChangeText={set('state')} placeholder="e.g. Uttar Pradesh" error={err.state} hint="Decides the tax on this shop's bills" />
                <Field label="Pincode" value={f.pincode} onChangeText={(v) => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={err.pincode} style={{ marginBottom: 0 }} />
            </Card>

            <SectionTitle section="riders">Delivery</SectionTitle>
            <Card>
                <Field label="Minimum order (₹)" value={f.minOrder} onChangeText={(v) => set('minOrder')(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={err.minOrder} />
                <Field label="Delivery radius (km)" value={f.radiusKm} onChangeText={(v) => set('radiusKm')(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={err.radiusKm} hint="How far from the shop it delivers" style={{ marginBottom: 0 }} />
            </Card>

            <SectionTitle section="people">Shop location on the map</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>
                    The delivery radius and distance-based delivery fees are measured from this point.
                </Text>
                <Button title={hasPoint ? 'Change the pin on the map' : 'Point on the map'} icon="pin" onPress={() => setMapOpen(true)} style={{ marginBottom: spacing.md }} />
                <MapPicker
                    visible={mapOpen}
                    initial={hasPoint ? { latitude: f.latitude, longitude: f.longitude } : null}
                    onClose={() => setMapOpen(false)}
                    onPick={(p) => {
                        setF((x) => ({
                            ...x, latitude: String(p.latitude), longitude: String(p.longitude),
                            line: x.line || p.line || '', city: x.city || p.city || '', pincode: x.pincode || p.pincode || '',
                        }));
                        setMapOpen(false);
                    }}
                />
                <Field label="Latitude" value={f.latitude} onChangeText={(v) => set('latitude')(decimal(v))} keyboardType="numbers-and-punctuation" error={err.latitude} placeholder="e.g. 18.5204" />
                <Field label="Longitude" value={f.longitude} onChangeText={(v) => set('longitude')(decimal(v))} keyboardType="numbers-and-punctuation" error={err.longitude} placeholder="e.g. 73.8567" style={{ marginBottom: hasPoint ? spacing.md : 0 }} />
                {hasPoint ? (
                    <Button
                        title="Check this point on the map"
                        icon="pin"
                        kind="soft"
                        small
                        onPress={() => Linking.openURL(`geo:${f.latitude},${f.longitude}?q=${f.latitude},${f.longitude}`).catch(() => toast('No map app found', 'error'))}
                    />
                ) : null}
            </Card>

            <SectionTitle section="money">Business and billing</SectionTitle>
            <Card>
                <Field label="Legal name" value={f.legalName} onChangeText={set('legalName')} />
                <Field label="GST number" value={f.gstin} onChangeText={(v) => set('gstin')(v.toUpperCase())} autoCapitalize="characters" maxLength={15} error={err.gstin} hint="Only you can set this. GST is charged on this shop's bills only while this number is filled." />
                <Field label="FSSAI number" value={f.fssai} onChangeText={(v) => set('fssai')(v.replace(/\D/g, '').slice(0, 14))} keyboardType="number-pad" error={err.fssai} />
                <Field label="Billing email" value={f.billingEmail} onChangeText={set('billingEmail')} keyboardType="email-address" autoCapitalize="none" hint="Bills and money mails go here. Empty = the owners' emails." error={err.billingEmail} style={{ marginBottom: 0 }} />
            </Card>

            <SectionTitle section="catalog">Rent invoices</SectionTitle>
            <Card>
                <Field label="GST on this shop's rent (%)" value={f.gstPercent} onChangeText={(v) => set('gstPercent')(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" error={err.gstPercent} hint="Empty = 18%. Added only if your GST number is saved." />
                <Field label="Rent starts from month" value={f.startMonth} onChangeText={(v) => set('startMonth')(v.replace(/[^\d-]/g, '').slice(0, 7))} keyboardType="numbers-and-punctuation" error={err.startMonth} placeholder="2026-10" style={{ marginBottom: 0 }} />
            </Card>

            <SectionTitle section="settings">The shop's app</SectionTitle>
            <Card>
                <Field
                    label="Android package id"
                    value={f.androidPackage}
                    onChangeText={(v) => set('androidPackage')(v.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                    autoCapitalize="none"
                    error={err.androidPackage}
                    hint={`Used when this shop's app is built. The shop code is ${orig.slug}.`}
                    placeholder="com.mycompany.shopname"
                    style={{ marginBottom: 0 }}
                />
            </Card>

            <SectionTitle section="alerts">Shop status</SectionTitle>
            <Card>
                <Segmented
                    value={f.status}
                    onChange={(v) => { if (v === 'suspended' && f.status !== 'suspended') setConfirmStatus(true); else set('status')(v); }}
                    options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]}
                />
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>
                    A suspended shop stops taking orders. Customers only see "not accepting orders right now".
                </Text>
            </Card>

            <ConfirmSheet
                visible={confirmStatus}
                onClose={() => setConfirmStatus(false)}
                title="Suspend this shop?"
                message="Customers will not be able to order. You can set it back to Active any time."
                confirmLabel="Suspend shop"
                danger
                onConfirm={async () => { set('status')('suspended'); }}
            />
        </Screen>
    );
}
