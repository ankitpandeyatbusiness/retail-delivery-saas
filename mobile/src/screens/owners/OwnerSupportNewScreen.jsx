// A new help request: what it is about, a title, the message, and up to 3 pictures (screenshots help a lot).
import React, { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ChoiceBox, Label, Hint } from '../../components/owners/menuBits';
import PictureStrip from '../../components/owners/PictureStrip';
import { createSupport, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { SUPPORT_TOPICS } from '../../utils/owners/supportRules';
import { showToast } from '../../components/customers/shop';

export default function OwnerSupportNewScreen() {
    const nav = useNavigation();
    const [category, setCategory] = useState('');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [photos, setPhotos] = useState([]);
    const [sending, setSending] = useState(false);
    const refId = useMemo(() => `s${Date.now().toString(36)}`, []);   // a short name for this request's pictures

    const send = async () => {
        if (!category) { showToast('Choose what your request is about'); return; }
        if (subject.trim().length < 3) { showToast('Write a short title (at least 3 letters)'); return; }
        if (!message.trim()) { showToast('Tell us what happened'); return; }
        setSending(true);
        try {
            const t = await createSupport({
                category, subject: subject.trim(), message: message.trim(), photos,
                appVersion: Constants.expoConfig?.version || undefined, platform: Platform.OS,
            });
            showToast('Sent. We will reply here.');
            nav.replace('OwnerSupportTicket', { id: String(t.id) });
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSending(false); }
    };

    return (
        <FormPage title="Ask for help" footer={<Button label="Send request" icon="send" busy={sending} onPress={send} />}>
            <Group title="What is it about">
                <ChoiceBox options={SUPPORT_TOPICS} value={category} onChange={setCategory} last />
            </Group>
            <Group title="Tell us more" hint="The more you tell us, the faster we can fix it. We already know your shop, phone and app version.">
                <TextBox label="Title" value={subject} onChangeText={setSubject} maxLength={100} placeholder="e.g. My monthly bill looks too high" />
                <TextBox label="What happened" value={message} onChangeText={setMessage} multiline maxLength={2000} placeholder="Write it in your own words" last />
            </Group>
            <Group title="Pictures (optional)" hint="A screenshot of the problem helps. Up to 3.">
                <PictureStrip value={photos} onChange={setPhotos} refId={refId} />
            </Group>
        </FormPage>
    );
}
