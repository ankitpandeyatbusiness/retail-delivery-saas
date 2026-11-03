import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../theme';
import { Button } from './ui';
import { Field } from './inputs';
import { Sheet, toast } from './feedback';
import { errMsg } from '../api/adminClient';
import { createBrand, addBranch, addBrandOwner, deleteBrand } from '../api/brandsApi';
import { useSupreme } from '../hooks/useSupreme';
import { goTab } from '../navigation/goTo';

// One button on a shop: "Make this shop a brand". It creates the brand, attaches this shop as its first branch and (if a number is typed)
// adds the brand owner. If the shop cannot be attached, the brand is taken back so nothing is left half-made.
export default function MakeBrandCard({ tenant, onDone }) {
    const t = useTheme();
    const nav = useNavigation();
    const supreme = useSupreme();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [city, setCity] = useState('');
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    if (!supreme || tenant.brandId) return null;

    const start = () => { setName(tenant.name || ''); setCity(tenant.address?.city || ''); setPhone(''); setOpen(true); };
    const run = async () => {
        setBusy(true);
        let brand = null;
        try {
            brand = (await createBrand({ name: name.trim() })).brand;
            await addBranch(brand._id, { tenantId: tenant._id || tenant.id, city: city.trim() });
        } catch (e) {
            if (brand) await deleteBrand(brand._id).catch(() => { });
            toast(errMsg(e), 'error'); setBusy(false); return;
        }
        let note = 'Done. This shop is now the first branch of the brand.';
        if (phone.length === 10) {
            try { await addBrandOwner(brand._id, phone); } catch (e) { note = `The brand is made, but the owner was not added: ${errMsg(e)}`; }
        }
        setBusy(false); setOpen(false); toast(note); onDone?.();
        goTab(nav, 'MoreTab', { screen: 'BrandDetail', params: { id: brand._id } });
    };

    return (
        <View style={{ marginBottom: spacing.md, padding: spacing.lg, borderRadius: 16, backgroundColor: t.surface }}>
            <Text style={{ color: t.text, fontWeight: '800' }}>Brand with branches</Text>
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>If this client has more outlets, make this shop a brand. Nothing changes for the shop, and you can add the other outlets after.</Text>
            <View style={{ marginTop: spacing.md }}><Button title="Make this shop a brand" icon="shops" kind="outline" onPress={start} /></View>
            <Sheet visible={open} onClose={() => setOpen(false)} title="Make this shop a brand">
                <Field label="Brand name" value={name} onChangeText={setName} maxLength={80} />
                <Field label="City of this shop" value={city} onChangeText={setCity} maxLength={60} />
                <Field label="Brand owner's phone (optional)" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>The brand owner can switch between all the branches and see them together. You can add or change owners later on the brand page.</Text>
                <Button title="Make brand" loading={busy} disabled={name.trim().length < 2 || !city.trim() || (phone.length > 0 && phone.length < 10)} onPress={run} />
            </Sheet>
        </View>
    );
}
