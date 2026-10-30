import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, KeyValue, SectionTitle, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import { fetchServiceInquiry } from '../../api/servicesApi';
import { errMsg } from '../../api/adminClient';

const when = (d) => new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const show = (a) => (Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? 'Yes' : 'No') : String(a.value));

// One inquiry thread to READ (a dispute, a complaint). There is no reply box: the replies belong to the shop's owner, and his private note is never shown here.
export default function ServicesInquiryScreen() {
    const t = useTheme();
    const { id } = useRoute().params || {};
    const [i, setI] = useState(null);
    const [err, setErr] = useState('');
    const load = async () => { setErr(''); try { setI(await fetchServiceInquiry(id)); } catch (e) { setErr(errMsg(e)); } };
    useEffect(() => { load(); }, [id]);

    if (!i) return <Screen title="Inquiry">{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    return (
        <Screen title={i.serviceName} subtitle={i.shop?.name}>
            <Card>
                <KeyValue label="Customer" value={`${i.name} · ${i.phone}`} />
                <KeyValue label="Status" value={i.status} />
                <KeyValue label="Sent" value={when(i.createdAt)} />
                {i.estimate ? <KeyValue label="Estimate" value={`₹${i.estimate}`} /> : null}
                <KeyValue label="Owner has opened it" value={i.ownerUnread ? 'No' : 'Yes'} last />
            </Card>
            {(i.answers || []).length ? (
                <>
                    <SectionTitle section="orders">Their answers</SectionTitle>
                    <Card>{i.answers.map((a, n) => <KeyValue key={a.id} label={a.label} value={show(a)} last={n === i.answers.length - 1} />)}</Card>
                </>
            ) : null}
            <SectionTitle section="orders">Conversation</SectionTitle>
            {(i.messages || []).map((m, n) => (
                <View key={n} style={{ alignSelf: m.from === 'owner' ? 'flex-end' : 'flex-start', maxWidth: '85%', marginBottom: spacing.sm }}>
                    <View style={{ backgroundColor: m.from === 'owner' ? t.primary : t.surface, borderRadius: radius.md, borderWidth: m.from === 'owner' ? 0 : 1, borderColor: t.border, padding: spacing.md }}>
                        <Text style={{ color: m.from === 'owner' ? '#FFFFFF' : t.text, fontSize: font.md }}>{m.text}</Text>
                    </View>
                    <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2, alignSelf: m.from === 'owner' ? 'flex-end' : 'flex-start' }}>{m.from === 'owner' ? 'Shop' : 'Customer'} · {when(m.at)}</Text>
                </View>
            ))}
            <Badge label="Read only" tone="neutral" />
        </Screen>
    );
}
