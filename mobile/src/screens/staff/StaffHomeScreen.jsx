// The work screen of a kitchen or waiter person. For now it confirms who is signed in and for which shop; the live order queue (kitchen)
// and the tables to serve (waiter) are added to this screen next. Pull down to refresh.
import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Card } from '../../components/owners/ui';
import { JobBadge, StaffHeader, JOBS } from '../../components/staff/staffBits';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { tr } from '../../i18n';

export default function StaffHomeScreen() {
    const { background, text, muted, primary } = useBrand();
    const me = useStaffStore((s) => s.me);
    const [busy, setBusy] = useState(false);
    const role = me?.role === 'waiter' ? 'waiter' : 'kitchen';
    const refresh = async () => { setBusy(true); await useStaffStore.getState().load(); setBusy(false); };
    const hello = me?.name ? tr('Hello, {name}', { name: me.name.split(' ')[0] }) : tr('Hello');

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={hello} subtitle={me?.shop} />
            <ScrollView
                contentContainerStyle={{ paddingBottom: 120 }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={busy} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
            >
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                            <Ionicons name={JOBS[role].icon} size={26} color={primary} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: text, fontSize: 17, fontWeight: '900' }} numberOfLines={1}>{me?.shop}</Text>
                            <View style={{ marginTop: 6 }}><JobBadge role={role} /></View>
                        </View>
                    </View>
                </Card>
                <Card>
                    <Text style={{ color: text, fontSize: 15, fontWeight: '800' }}>{tr('You are signed in')}</Text>
                    <Text style={{ color: muted, fontSize: 13.5, lineHeight: 20, marginTop: 4 }}>
                        {role === 'kitchen' ? tr('The orders to cook will appear on this screen.') : tr('The dishes to serve and the table requests will appear on this screen.')}
                    </Text>
                </Card>
            </ScrollView>
        </View>
    );
}
