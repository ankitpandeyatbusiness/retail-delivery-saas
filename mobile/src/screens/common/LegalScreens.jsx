// Terms, privacy and the agreement you agreed to: read-only pages. Once agreed they can only be read, never taken back.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader } from '../../components/owners/ui';
import LegalText from '../../components/common/LegalText';
import { fetchPublicLegal, fetchLegalDoc, fetchLegalMine } from '../../api/common/legalApi';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr, tl } from '../../i18n';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// one document. params: { key, pub } (pub = the public customer pages, readable without logging in)
export function LegalDocScreen() {
    const { background, muted, error } = useBrand();
    const { key, pub } = useRoute().params || {};
    const [doc, setDoc] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        (pub ? fetchPublicLegal(key) : fetchLegalDoc(key)).then(setDoc).catch((e) => setErr(e?.response?.data?.error || tr('Could not open this page.')));
    }, [key, pub]);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={doc?.title ? tr(doc.title) : tr('Terms')} />
            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 32 }}>
                {!doc && !err ? <ListShimmer count={2} /> : null}
                {err ? <Text style={{ color: error }}>{err}</Text> : null}
                {doc ? (
                    <>
                        <LegalText text={doc.body} title={doc.title} />
                        <Text style={{ color: muted, fontSize: 12, marginTop: 20 }}>{doc.no ? tr('Version {no}{v2}', { no: doc.no, v2: doc.publishedAt ? `, ${day(doc.publishedAt)}` : '' }) : tr('This version has not been sent yet')}</Text>
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
            <PageHeader title={tr('Terms and privacy')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                {items === null ? <ListShimmer count={2} /> : items.map((d) => (
                    <Pressable key={d.key} onPress={() => nav.navigate('LegalDoc', { key: d.key, pub: d.pub })} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: border }}>
                        <Ionicons name="document-text-outline" size={24} color={primary} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr(d.title)}</Text>
                            {d.mustAgree ? (
                                <Text style={{ color: d.upToDate ? ok : muted, fontSize: 12, marginTop: 2 }}>
                                    {d.upToDate ? tr('You agreed to version {agreedVersion} on {day}', { agreedVersion: d.agreedVersion, day: day(d.agreedAt) }) : d.version ? tr('A new version is waiting for you') : tr('Not sent yet')}
                                </Text>
                            ) : (d.version ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Version {version}', { version: d.version })}</Text> : null)}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

// About Us: a short write-up about the platform, then the documents. Shop owners (also when they look at the customer app) see the shop owner
// documents and the customer documents; customers see the customer ones only.
export function AboutUsScreen() {
    const nav = useNavigation();
    const { background, text, muted, border, primary, ok } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const [doc, setDoc] = useState(null);
    const [mine, setMine] = useState([]);
    useEffect(() => { if (role && role !== 'customer') fetchLegalMine().then((r) => setMine(r.items || [])).catch(() => { }); }, [role]);
    useEffect(() => { fetchPublicLegal('about_us').then(setDoc).catch(() => setDoc({ title: 'About Us', body: '' })); }, []);
    const links = [
        ...(role === 'admin' ? [{ key: 'owner_terms', title: tl('Terms of Service for Shop Owners') }, { key: 'owner_privacy', title: tl('Privacy Policy for Shop Owners') }] : []),
        { key: 'customer_terms', title: tl('Terms of Service for Customers'), pub: true },
        { key: 'privacy', title: tl('Privacy Policy for Customers'), pub: true },
    ];
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('About Us')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                <View style={{ padding: 18 }}>
                    {doc === null ? <ListShimmer count={2} /> : <LegalText text={doc.body} title={doc.title} />}
                </View>
                {links.map((d) => (
                    <Pressable key={d.key} onPress={() => nav.navigate('LegalDoc', { key: d.key, pub: d.pub })} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderTopWidth: 0.5, borderTopColor: border }}>
                        <Ionicons name="document-text-outline" size={24} color={primary} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr(d.title)}</Text>
                            {(() => { const m = mine.find((x) => x.key === d.key); return m?.mustAgree ? <Text style={{ color: m.upToDate ? ok : muted, fontSize: 12, marginTop: 2 }}>{m.upToDate ? tr('You agreed to version {agreedVersion} on {day}', { agreedVersion: m.agreedVersion, day: day(m.agreedAt) }) : m.version ? tr('A new version is waiting for you') : tr('Not sent yet')}</Text> : null; })()}
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}
