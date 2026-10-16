// Terms, privacy and the agreement you agreed to: read-only pages. Once agreed they can only be read, never taken back.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader } from '../../components/owners/ui';
import LegalText from '../../components/common/LegalText';
import { fetchPublicLegal, fetchLegalDoc, fetchLegalMine } from '../../api/common/legalApi';
import { useAuthStore } from '../../store/common/useAuthStore';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// one document. params: { key, pub } (pub = the public customer pages, readable without logging in)
export function LegalDocScreen() {
    const { background, muted, error } = useBrand();
    const { key, pub } = useRoute().params || {};
    const [doc, setDoc] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        (pub ? fetchPublicLegal(key) : fetchLegalDoc(key)).then(setDoc).catch((e) => setErr(e?.response?.data?.error || 'Could not open this page.'));
    }, [key, pub]);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={doc?.title || 'Terms'} />
            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
                {!doc && !err ? <ActivityIndicator style={{ marginTop: 30 }} /> : null}
                {err ? <Text style={{ color: error }}>{err}</Text> : null}
                {doc ? (
                    <>
                        <LegalText text={doc.body} title={doc.title} />
                        <Text style={{ color: muted, fontSize: 12, marginTop: 20 }}>{doc.no ? `Version ${doc.no}${doc.publishedAt ? `, ${day(doc.publishedAt)}` : ''}` : 'This version has not been sent yet'}</Text>
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}

// the list: your own agreement (with the version you agreed to), the terms of service and the privacy policy
export function LegalListScreen() {
    const nav = useNavigation();
    const { background, text, muted, border, primary, ok } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const [items, setItems] = useState(null);
    useEffect(() => {
        if (role === 'customer') { setItems([{ key: 'customer_terms', title: 'Terms of Service', pub: true }, { key: 'privacy', title: 'Privacy Policy', pub: true }]); return; }
        fetchLegalMine().then((r) => setItems(r.items)).catch(() => setItems([]));
    }, [role]);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Terms and privacy" />
            <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
                {items === null ? <ActivityIndicator style={{ marginTop: 30 }} /> : items.map((d) => (
                    <Pressable key={d.key} onPress={() => nav.navigate('LegalDoc', { key: d.key, pub: d.pub })} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: border }}>
                        <Ionicons name="document-text-outline" size={24} color={primary} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{d.title}</Text>
                            {d.mustAgree ? (
                                <Text style={{ color: d.upToDate ? ok : muted, fontSize: 12, marginTop: 2 }}>
                                    {d.upToDate ? `You agreed to version ${d.agreedVersion} on ${day(d.agreedAt)}` : d.version ? 'A new version is waiting for you' : 'Not sent yet'}
                                </Text>
                            ) : (d.version ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>Version {d.version}</Text> : null)}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}
