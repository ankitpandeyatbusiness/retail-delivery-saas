import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Avatar } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, ConfirmSheet, Sheet, toast } from '../../components/feedback';
import { fetchOwners, addOwner, removeOwner } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { ago } from '../../utils/format';

export default function ShopOwnersScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const [phone, setPhone] = useState('');
    const [busy, setBusy] = useState(false);
    const [removing, setRemoving] = useState(null);

    const load = useCallback(async () => {
        try { setItems((await fetchOwners(shopId)).items); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

    const add = async () => {
        if (!/^[6-9]\d{9}$/.test(phone)) { toast('Enter a valid 10-digit number', 'error'); return; }
        setBusy(true);
        try {
            const r = await addOwner(shopId, phone);
            toast(r.alreadyOwner ? 'Already an owner' : 'Owner added');
            setAdding(false); setPhone(''); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Owners" subtitle={name} footer={<Button title="Add an owner" icon="person-add-outline" onPress={() => setAdding(true)} />}>
            {items === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={4} />) : !items.length ? (
                <Empty icon="key" title="No owner yet" hint="Add the mobile number of the person who will run this shop." />
            ) : items.map((o) => (
                <Card key={String(o.id)} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Avatar section="money" name={o.name || o.phone} />
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '700', fontSize: font.md }}>{o.name || o.phone}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{o.name ? `${o.phone} · ` : ''}last login {ago(o.lastLoginAt)}</Text>
                        </View>
                    </View>
                    <Button title="Remove as owner" kind="dangerSoft" small style={{ marginTop: spacing.md }} onPress={() => setRemoving(o)} />
                </Card>
            ))}

            <Sheet visible={adding} onClose={() => setAdding(false)} title="Add an owner">
                <Text style={{ color: t.muted, marginBottom: spacing.lg }}>
                    This number logs in to the shop panel with an OTP. If it already belongs to a customer, they become the owner.
                </Text>
                <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" autoFocus />
                <Button title="Add owner" onPress={add} loading={busy} />
            </Sheet>

            <ConfirmSheet
                visible={!!removing}
                onClose={() => setRemoving(null)}
                title="Remove this owner?"
                message="They become a normal customer and lose access to the shop panel at once."
                confirmLabel="Remove owner"
                danger
                onConfirm={async () => {
                    try { await removeOwner(shopId, removing.id); toast('Owner removed'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </Screen>
    );
}
