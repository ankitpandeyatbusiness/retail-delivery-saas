// Deny a table booking: the whole deposit goes back to the guest at once, and the guest is told. The owner may add a reason after the standard message.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Button, Card, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox } from '../../components/owners/menuBits';
import { booking as api, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const QUICK = ['We are fully booked at that time.', 'We are closed that day.', 'A private event is on that day.', 'The kitchen cannot take a group this size.'];

export default function OwnerBookingDenyScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const { text, muted, border, surface } = useBrand();
    const [b, setB] = useState(null);
    const [err, setErr] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => { api.get(id).then(setB).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this booking.')); }); }, [id]);
    if (!b) return <FormPage title={tr('Deny booking')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;

    const paid = b.deposit?.status === 'paid';
    const open = ['confirmed', 'held'].includes(b.status);
    const amount = b.deposit?.amount || 0;
    const standard = tr('{shop} cancelled your table booking for {d} at {t}.', { shop: tr('The restaurant'), d: b.date, t: b.time }) + (paid ? ' ' + tr('Your full deposit of ₹{n} is being refunded to you.', { n: amount }) : '');

    const send = async () => {
        setBusy(true);
        try { await api.deny(id, message.trim()); showToast(paid ? tr('Booking denied. The deposit is on its way back.') : tr('Booking denied')); nav.goBack(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <FormPage title={tr('Deny booking')} footer={open ? <Button label={paid ? tr('Deny and refund ₹{n}', { n: amount }) : tr('Deny booking')} icon="close-circle" kind="danger" busy={busy} onPress={send} /> : null}>
            <Card style={{ marginHorizontal: 0 }}>
                <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{b.name} · {tr('{n} guests', { n: b.party })}</Text>
                <Text style={{ color: muted, marginTop: 2 }}>{b.date} · {b.time} · {tr('Code')} {b.code}</Text>
                <Text style={{ color: text, marginTop: 8, fontWeight: '700' }}>{paid ? tr('The whole deposit of ₹{n} goes back to the guest at once.', { n: amount }) : tr('No deposit was paid.')}</Text>
            </Card>
            {!open ? <Text style={{ color: muted, textAlign: 'center', marginVertical: 14 }}>{tr('This booking is already {s}.', { s: String(b.status).replace('_', ' ') })}</Text> : (
                <>
                    <Group title={tr('What the guest is told')} hint={tr('This text is always sent. Your reason below is added after it.')}>
                        <Text style={{ color: text, lineHeight: 20 }}>{standard}</Text>
                    </Group>
                    <Group title={tr('Add a reason (optional)')}>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            {QUICK.map((q) => (
                                <Pressable key={q} onPress={() => setMessage(q)} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                    <Text style={{ color: text, fontSize: 13 }}>{tr(q)}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <TextBox value={message} onChangeText={setMessage} multiline maxLength={300} placeholder={tr('Write your own reason')} last />
                    </Group>
                </>
            )}
        </FormPage>
    );
}
