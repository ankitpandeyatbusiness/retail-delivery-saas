// The Shop hub: everything that is not one of the five tabs. Opened from the shop logo at the top of every tab.
import React from 'react';
import { View, ScrollView, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Row, SectionTitle } from '../../components/owners/ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { ask } from '../../components/common/dialog';

// [icon, title, subtitle, phase, what it will hold]
const GROUPS = [
    ['Customers and care', [
        ['people', 'Customers', 'Your customers, their orders, allow cash on delivery', 'Phase 5', ['Search and view customers', 'Edit name and notes', 'Allow cash on delivery again']],
        ['chatbubble-ellipses', 'Complaints', 'Reply to and resolve complaints', 'Phase 5', ['Complaint inbox', 'Reply and resolve']],
        ['star', 'Reviews', 'What customers say about your dishes and delivery', 'Phase 5', ['Dish and delivery ratings']],
        ['megaphone', 'Messages', 'Send a message to customers or riders', 'Phase 5', ['Send and see sent messages']],
    ]],
    ['Offers', [
        ['pricetag', 'Coupons', 'Discount codes', 'Phase 5', ['Create and switch coupons on or off']],
        ['images', 'Banners', 'Pictures on the home screen', 'Phase 5', ['Banners with dates']],
        ['albums', 'Collections', 'Curated strips of dishes', 'Phase 5', ['Collections of items with dates']],
    ]],
    ['Shop', [
        ['time', 'Opening hours', 'Weekly hours and holidays', 'Phase 6', ['Weekly hours, closed dates']],
        ['navigate', 'Delivery area and fees', 'Pin, radius, minimum order, delivery fee', 'Phase 6', ['Map pin and radius', 'Delivery fee rules', 'Packaging charge and tips']],
        ['settings', 'Shop settings', 'Phone, address, cash limit, alerts', 'Phase 6', ['Contact and address', 'Cash on delivery limit', 'SMS alerts']],
        ['list', 'Activity log', 'Who changed what', 'Phase 6', ['Owner activity history']],
    ]],
];

export default function ShopHubScreen() {
    const nav = useNavigation();
    const { background, muted, error } = useBrand();
    const theme = useThemeStore((s) => s.theme);
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);

    const out = async () => {
        const yes = await ask({ title: 'Log out?', message: 'You will stop getting new order alerts on this phone.', confirmText: 'Log out', destructive: true });
        if (yes) logout();
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={theme.name || 'Shop'} />
            <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
                <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 6 }}>Signed in as {user?.name || user?.phone || 'owner'}</Text>

                <SectionTitle title="Alerts" />
                <Card>
                    <Row icon="volume-high" title="Soundbox" subtitle="New-order sound, voice and volume" onPress={() => nav.navigate('Soundbox')} last />
                </Card>

                {GROUPS.map(([group, rows]) => (
                    <View key={group}>
                        <SectionTitle title={group} />
                        <Card>
                            {rows.map(([icon, title, subtitle, phase, items], i) => (
                                <Row
                                    key={title}
                                    icon={icon}
                                    title={title}
                                    subtitle={subtitle}
                                    last={i === rows.length - 1}
                                    onPress={() => nav.navigate('OwnerStub', { title, phase, items, icon })}
                                />
                            ))}
                        </Card>
                    </View>
                ))}

                <Card style={{ marginTop: 8 }}>
                    <Row icon="log-out" title="Log out" color={error} onPress={out} last />
                </Card>
            </ScrollView>
        </View>
    );
}
