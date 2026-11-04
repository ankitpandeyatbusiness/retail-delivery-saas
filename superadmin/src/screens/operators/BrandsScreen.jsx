import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, ListRow } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchBrands, createBrand } from '../../api/brandsApi';
import { errMsg } from '../../api/adminClient';

// Brands with branches (like "Savera" in Delhi, UP and Mumbai). Each branch is a normal shop; the brand groups them.
export default function BrandsScreen() {
    const nav = useNavigation();
    const supreme = useSupreme();
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [limit, setLimit] = useState('3');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => { setErr(''); try { setR(await fetchBrands()); } catch (e) { setErr(errMsg(e)); } }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const create = async () => {
        setBusy(true);
        try {
            const x = await createBrand({ name: name.trim(), branchLimit: Number(limit) || 3 });
            setOpen(false); setName(''); toast('Brand created');
            nav.navigate('BrandDetail', { id: x.brand._id });
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Brands and branches" subtitle="One brand, many branches, each its own shop" onRefresh={load}>
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {r && !r.items.length ? <Card><Text>No brand yet. A brand groups the branches of one business, for example Savera in Delhi and Mumbai.</Text></Card> : null}
            {r && r.items.length ? (
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                    {r.items.map((b, i) => (
                        <ListRow key={b._id} section="platform" icon="shops" title={b.name} subtitle={`${b.branchCount} of ${b.branchLimit} branches`} onPress={() => nav.navigate('BrandDetail', { id: b._id })} last={i === r.items.length - 1} />
                    ))}
                </Card>
            ) : null}
            {supreme ? <View style={{ marginTop: spacing.lg }}><Button title="New brand" icon="add" onPress={() => setOpen(true)} /></View> : null}

            <Sheet visible={open} onClose={() => setOpen(false)} title="New brand">
                <Field label="Brand name" placeholder="e.g. Savera" hint="The name of the group of branches, shown to the brand owner." value={name} onChangeText={setName} maxLength={80} />
                <Field label="Most branches allowed" value={limit} onChangeText={(v) => setLimit(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" />
                <Button title="Create" loading={busy} disabled={name.trim().length < 2} onPress={create} />
            </Sheet>
        </Screen>
    );
}
