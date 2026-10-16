// Tabs and pages whose real screens arrive in later phases. Each one already sits in the right place in the
// navigation, so the panel can be walked through end to end while the phases are built.
import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, PageHeader, Card, Pill } from '../../components/owners/ui';

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

export const OwnerMenuScreen = () => (
    <OwnerScreen title="Menu">
        <Soon icon="restaurant" title="Your menu" phase="Phase 2" items={[
            'Categories with timings, items with photos, sizes and add-ons',
            'In-stock switch and stock count on every item',
            'Collections for the home screen',
        ]} />
    </OwnerScreen>
);

export const OwnerRidersScreen = () => (
    <OwnerScreen title="Riders">
        <Soon icon="bicycle" title="Delivery team" phase="Phase 3" items={[
            'Add riders, switch them off, see who is online',
            'Live map of your riders',
            'Cash on delivery ledger and handover',
            'Rider performance and delivery rules',
        ]} />
    </OwnerScreen>
);

export const OwnerMoneyScreen = () => (
    <OwnerScreen title="Money">
        <Soon icon="wallet" title="Earnings and bills" phase="Phase 4" items={[
            'Sales by day, week and month, top items, payment split',
            'Online payments, refunds and disputes',
            'SMS wallet and top-up',
            'Rent invoices and payment',
        ]} />
    </OwnerScreen>
);

// A generic page for hub destinations that are not built yet. Opened with params { title, phase, items }.
export function OwnerStubPage() {
    const { title, phase, items = [], icon = 'construct' } = useRoute().params || {};
    const { background } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={title || 'Coming soon'} />
            <ScrollView><Soon icon={icon} title={title || 'Coming soon'} phase={phase || 'Later'} items={items} /></ScrollView>
        </View>
    );
}
