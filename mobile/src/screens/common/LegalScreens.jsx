// Terms, privacy and About Us: read-only pages. The terms and privacy texts come from the server (public, the same pages as /legal/terms ...), nothing to agree to:
// using the app means accepting them. About Us is written right here in the app, so it appears at once.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import { ListShimmer } from '../../components/owners/shimmer';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader } from '../../components/owners/ui';
import LegalText from '../../components/common/LegalText';
import { fetchPublicLegal, fetchPoweredBy } from '../../api/common/legalApi';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr, tl } from '../../i18n';

// one document. params: { key }
export function LegalDocScreen() {
    const { background, muted, error } = useBrand();
    const { key } = useRoute().params || {};
    const [doc, setDoc] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        fetchPublicLegal(key).then(setDoc).catch((e) => setErr(e?.response?.data?.error || tr('Could not open this page.')));
    }, [key]);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={doc?.title ? tr(doc.title) : tr('Terms')} />
            {/* the website hides the browser's own scrollbar here (the page still scrolls); phones are untouched */}
            <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 32 }} showsVerticalScrollIndicator={Platform.OS === 'web' ? false : undefined}>
                {!doc && !err ? <ListShimmer count={2} /> : null}
                {err ? <Text style={{ color: error }}>{err}</Text> : null}
                {doc ? <LegalText text={doc.body} title={doc.title} /> : null}
            </ScrollView>
        </View>
    );
}

// the documents of the person who is logged in
const docsFor = (role) => {
    if (role === 'admin') return [{ key: 'owner_terms', title: tl('Terms of Service for Shop Owners') }, { key: 'owner_privacy', title: tl('Privacy Policy for Shop Owners') }];
    if (role === 'rider') return [{ key: 'rider_terms', title: tl('Terms of Service for Riders') }, { key: 'rider_privacy', title: tl('Privacy Policy for Riders') }];
    if (role === 'kitchen' || role === 'waiter') return [{ key: 'staff_terms', title: tl('Terms of Service for Kitchen Staff and Waiters') }, { key: 'staff_privacy', title: tl('Privacy Policy for Kitchen Staff and Waiters') }];
    return [{ key: 'customer_terms', title: tl('Terms of Service') }, { key: 'privacy', title: tl('Privacy Policy') }];
};

function DocRows({ docs, topBorder }) {
    const nav = useNavigation();
    const { text, muted, border, primary } = useBrand();
    return docs.map((d) => (
        <Pressable key={d.key} onPress={() => nav.navigate('LegalDoc', { key: d.key })} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, ...(topBorder ? { borderTopWidth: 0.5, borderTopColor: border } : { borderBottomWidth: 0.5, borderBottomColor: border }) }}>
            <Ionicons name="document-text-outline" size={24} color={primary} />
            <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr(d.title)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
        </Pressable>
    ));
}

// the list: the terms of service and the privacy policy that belong to you
export function LegalListScreen() {
    const { background } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Terms and privacy')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                <DocRows docs={docsFor(role)} />
            </ScrollView>
        </View>
    );
}

const H = ({ children, first }) => {
    const { text } = useBrand();
    return <Text style={{ color: text, fontSize: 16, fontWeight: '900', marginTop: first ? 0 : 18, marginBottom: 4 }}>{children}</Text>;
};
const P = ({ children }) => {
    const { muted } = useBrand();
    return <Text style={{ color: muted, fontSize: 14.5, lineHeight: 21, marginTop: 3 }}>{children}</Text>;
};
const B = ({ children }) => {
    const { text } = useBrand();
    return <Text style={{ color: text, fontSize: 14.5, lineHeight: 21, marginTop: 3, paddingLeft: 14 }}>{'•  '}{children}</Text>;
};

// About Us: written here, in the app, so it shows at once. The names come from Platform business (fetchPoweredBy); until they arrive it says "Vivyaan".
// Then the documents. Everybody sees their own terms and privacy policy under it.
export function AboutUsScreen() {
    const { background } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const [info, setInfo] = useState({});
    useEffect(() => { fetchPoweredBy().then((x) => setInfo(x || {})).catch(() => { }); }, []);
    const platformName = info.platformName || 'Vivyaan';
    const { operatorName, email, contactPhone } = info;
    const contact = contactPhone && email ? tr('For any question call {contactPhone} or write to {email}.', { contactPhone, email })
        : contactPhone ? tr('For any question call {contactPhone}.', { contactPhone })
            : email ? tr('For any question write to {email}.', { email }) : tr('For any question, contact the support given in the app.');
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('About Us')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
                <View style={{ padding: 18 }}>
                    <H first>{tr('About {platformName}', { platformName })}</H>
                    <P>{tr('{platformName} helps restaurants and shops take orders and deliver them, all in one place.', { platformName })}</P>

                    <H>{tr('For customers')}</H>
                    <B>{tr('Order from your favourite shop in a few taps.')}</B>
                    <B>{tr('Pay cash on delivery or online.')}</B>
                    <B>{tr('Follow your order and your rider on the map.')}</B>
                    <B>{tr('Tell the shop if something is wrong, right in the app.')}</B>

                    <H>{tr('For shops')}</H>
                    <B>{tr('Your own ordering app for your customers.')}</B>
                    <B>{tr('An owner panel for orders, menu, riders, money and reports.')}</B>
                    <B>{tr('A rider app, and panels for your kitchen staff and waiters if you want them.')}</B>
                    <B>{tr('Alerts by app, SMS and email.')}</B>

                    {operatorName ? (
                        <>
                            <H>{tr('Who runs it')}</H>
                            <P>{tr('{platformName} is a product of {operatorName}, which runs the business and looks after billing and compliance. The technology is provided by an independent developer.', { platformName, operatorName })}</P>
                        </>
                    ) : null}

                    <H>{tr('Contact')}</H>
                    <P>{contact}</P>
                </View>
                <DocRows docs={docsFor(role)} topBorder />
            </ScrollView>
        </View>
    );
}
