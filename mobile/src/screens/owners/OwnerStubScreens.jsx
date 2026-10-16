// Tabs and pages whose real screens arrive in later phases. Each one already sits in the right place in the
// navigation, so the panel can be walked through end to end while the phases are built.
import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, PageHeader, Card, Empty, Pill, money } from '../../components/owners/ui';
import { fetchOrder } from '../../api/owners/shopApi';
import { acknowledge } from '../../utils/owners/soundbox';

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

export const OwnerOrdersScreen = () => (
    <OwnerScreen title="Orders">
        <Soon icon="receipt" title="Live order board" phase="Phase 1" items={[
            'New, cooking, ready and on-the-road orders with live counts',
            'Accept, reject with a reason, and move orders along',
            'Assign or change the rider, see the rider on the map',
            'Invoice PDF, customer call, search by order number',
        ]} />
    </OwnerScreen>
);

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

// The page a new-order push opens. Phase 1 turns this into the full order page; for now it shows the order.
export function OwnerOrderScreen() {
    const { id } = useRoute().params || {};
    const { background, text, muted } = useBrand();
    const [order, setOrder] = React.useState(null);
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => {
        acknowledge(id);   // he is looking at it: the chime stops for this order
        let alive = true;
        fetchOrder(id).then((o) => alive && setOrder(o)).catch(() => alive && setFailed(true));
        return () => { alive = false; };
    }, [id]);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={order ? `Order #${order.orderNo}` : 'Order'} />
            {failed ? <Empty icon="alert-circle-outline" title="Could not open this order" hint="Check your connection and try again." /> : null}
            {!order && !failed ? <ActivityIndicator style={{ marginTop: 40 }} /> : null}
            {order ? (
                <ScrollView>
                    <Card style={{ marginTop: 8 }}>
                        <Pill label={String(order.status).replace(/_/g, ' ')} />
                        {(order.items || []).map((l, i) => (
                            <View key={i} style={{ flexDirection: 'row', marginTop: 10 }}>
                                <Text style={{ color: text, fontWeight: '800', width: 34 }}>{l.quantity}×</Text>
                                <Text style={{ color: text, flex: 1 }}>{l.name}</Text>
                                <Text style={{ color: muted }}>{money(l.lineTotal)}</Text>
                            </View>
                        ))}
                        <Text style={{ color: text, fontWeight: '900', fontSize: 18, marginTop: 14 }}>Total {money(order.pricing?.total)}</Text>
                    </Card>
                    <Soon icon="flash" title="Accept, reject and assign a rider" phase="Phase 1" items={['The full order page with action buttons arrives in Phase 1.']} />
                </ScrollView>
            ) : null}
        </View>
    );
}
