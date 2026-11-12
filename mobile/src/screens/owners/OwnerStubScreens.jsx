// Tabs and pages whose real screens arrive in later phases. Each one already sits in the right place in the
// navigation, so the panel can be walked through end to end while the phases are built.
import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, PageHeader, Card, Pill } from '../../components/owners/ui';
import { tr } from '../../i18n';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Hero } from '../../components/owners/RiderDesk';

function Soon({ icon, title, phase, items }) {
    const { text, muted, primary } = useBrand();
    return (
        <Card style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Ionicons name={icon} size={26} color={primary} />
                <Text style={{ color: text, fontSize: 17, fontWeight: '900', marginLeft: 10, flex: 1 }}>{title}</Text>
                <Pill label={phase} />
            </View>
            {items.map((t) => (
                <View key={t} style={{ flexDirection: 'row', marginBottom: 6 }}>
                    <Ionicons name="ellipse" size={6} color={muted} style={{ marginTop: 7, marginRight: 10 }} />
                    <Text style={{ color: muted, flex: 1 }}>{t}</Text>
                </View>
            ))}
        </Card>
    );
}

// A generic page for hub destinations that are not built yet. Opened with params { title, phase, items }.
export function OwnerStubPage() {
    const { title, phase, items = [], icon = 'construct' } = useRoute().params || {};
    const { background, surface, border, text, muted, primary } = useBrand();
    const desk = useOwnerDesktop();   // a computer: a banner and what is coming, as rounded rows
    if (desk) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={title || tr('Coming soon')} />
                <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                    <View style={{ width: '100%', maxWidth: 900, alignSelf: 'center' }}>
                        <Hero icon={icon} title={title || tr('Coming soon')} subtitle={`${tr('We are building this')} · ${phase || tr('Later')}`} />
                        <View style={{ marginHorizontal: 16, padding: 8, borderRadius: 22, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                            {items.length ? items.map((t) => (
                                <View key={t} style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
                                    <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: alpha(primary, 0.13), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="sparkles" size={16} color={primary} /></View>
                                    <Text style={{ color: text, flex: 1, marginLeft: 12, fontSize: 14.5, fontWeight: '600' }}>{t}</Text>
                                </View>
                            )) : <Text style={{ color: muted, padding: 16 }}>{tr('This page is on its way.')}</Text>}
                        </View>
                    </View>
                </ScrollView>
            </View>
        );
    }
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={title || tr('Coming soon')} />
            <ScrollView><Soon icon={icon} title={title || tr('Coming soon')} phase={phase || 'Later'} items={items} /></ScrollView>
        </View>
    );
}
