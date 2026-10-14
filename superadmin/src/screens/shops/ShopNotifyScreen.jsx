import React, { useState } from 'react';
import { Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button } from '../../components/ui';
import { Field } from '../../components/inputs';
import { toast } from '../../components/feedback';
import { notifyShop } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

// Sends an in-app message to this shop's owner (shows in the owner's app notifications).
export default function ShopNotifyScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const send = async () => {
        if (!title.trim()) { setErr('Add a short title'); return; }
        setBusy(true);
        try {
            await notifyShop(shopId, { title: title.trim(), body: body.trim() || undefined, channel: 'app' });
            toast('Message sent to the owner');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); setBusy(false); }
    };

    return (
        <Screen title="Send message" subtitle={name} footer={<Button title="Send to owner" icon="send" onPress={send} loading={busy} />}>
            <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.lg }}>
                The owner sees this in the notifications of the shop app.
            </Text>
            <Field label="Title" value={title} onChangeText={(v) => { setTitle(v); setErr(''); }} maxLength={120} error={err} placeholder="e.g. Please update your menu prices" />
            <Field label="Message (optional)" value={body} onChangeText={setBody} maxLength={300} multiline hint={`${body.length}/300`} />
        </Screen>
    );
}
