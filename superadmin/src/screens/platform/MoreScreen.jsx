import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, KeyValue, Button, ListRow, Badge } from '../../components/ui';
import { fetchSupportCounts } from '../../api/supportApi';
import ProfileCard from '../../components/ProfileCard';
import { ConfirmSheet } from '../../components/feedback';
import { useAuthStore } from '../../store/useAuthStore';
import { useThemeStore } from '../../store/useThemeStore';
import { Segmented } from '../../components/inputs';
import pkg from '../../../package.json';

export default function MoreScreen() {
    const nav = useNavigation();
    const admin = useAuthStore((s) => s.admin);
    const logout = useAuthStore((s) => s.logout);
    const [confirm, setConfirm] = useState(false);
    const [help, setHelp] = useState(0);   // support requests waiting for a reply
    useFocusEffect(useCallback(() => { fetchSupportCounts().then((c) => setHelp(c.open || 0)).catch(() => { }); }, []));
    const mode = useThemeStore((s2) => s2.mode);
    const setMode = useThemeStore((s2) => s2.setMode);

    return (
        <Screen tabScreen title="More" subtitle="Account and platform">
            <ProfileCard name={admin?.name} subtitle={admin?.email} />

            <SectionTitle section="shops">Find and watch</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="shops" icon="search" title="Search everything" subtitle="Shops, orders, people, invoices" onPress={() => nav.navigate('Search')} />
                <ListRow section="riders" icon="shield" title="Shop health" subtitle="Scores, cancellations, late orders" onPress={() => nav.navigate('Health')} />
                <ListRow section="settings" icon="bolt" title="System and backups" subtitle="Database, SMS, nightly jobs, backups" onPress={() => nav.navigate('System')} />
                <ListRow section="money" icon="copy" title="Export data" subtitle="Orders, invoices, customers as Excel sheets" onPress={() => nav.navigate('Exports')} last />
            </Card>

            <SectionTitle section="alerts">Alerts and messages</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="orders" icon="message" title="Support requests" subtitle="Help requests from shop owners" right={help > 0 ? <Badge label={`${help} waiting`} tone="danger" /> : null} onPress={() => nav.navigate('Support')} />
                <ListRow section="alerts" icon="bell" title="Alerts inbox" subtitle="Late orders, unpaid bills, problems" onPress={() => nav.navigate('Inbox')} />
                <ListRow section="platform" icon="megaphone" title="Messages to owners" subtitle="Write to all shop owners" onPress={() => nav.navigate('OwnerMessages')} />
                <ListRow section="catalog" icon="message" title="Alert SMS" subtitle="SMS to your phone and what they cost" onPress={() => nav.navigate('AlertSettings')} />
                <ListRow section="settings" icon="tune" title="Notification rules" subtitle="How each event is delivered" onPress={() => nav.navigate('NotificationRules')} last />
            </Card>

            <SectionTitle section="platform">Platform</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="platform" icon="bank" title="Companies and Switch" subtitle="Who runs the platform now, and the Switch button" onPress={() => nav.navigate('Operators')} />
                <ListRow section="platform" icon="notes" title="Agreements and terms" subtitle="Read them; the supreme admin writes and sends them" onPress={() => nav.navigate('Agreements')} />
                <ListRow section="money" icon="rupee" title="Settlement sheet" subtitle="Who owes whom between the two of you, row by row" onPress={() => nav.navigate('Settlement')} />
                <ListRow section="money" icon="receipt" title="GST register" subtitle="Every bill and credit note of a month, with CGST, SGST and IGST" onPress={() => nav.navigate('GstRegister')} />
                <ListRow section="shops" icon="chart" title="Shops growth" subtitle="Top shops, who is growing, who is slowing down" onPress={() => nav.navigate('ShopsGrowth')} />
                <ListRow section="money" icon="chart" title="Owner report settings" subtitle="Monthly report email and the comparison shown to owners" onPress={() => nav.navigate('InsightsSettings')} />
                <ListRow section="platform" icon="live" title="Live tracking" subtitle="Riders on the map: how the server copes, and the switch" onPress={() => nav.navigate('LiveTracking')} />
                <ListRow section="alerts" icon="tool" title="Maintenance" subtitle="Pause every shop's app for an upgrade" onPress={() => nav.navigate('Maintenance')} />
                <ListRow section="settings" icon="crown" title="Superadmin team" subtitle="Add, revoke or restore superadmins" onPress={() => nav.navigate('Team')} />
                <ListRow section="platform" icon="notes" title="Audit log" subtitle="Who changed what, everywhere" onPress={() => nav.navigate('AuditLog')} />
                <ListRow section="shops" icon="user" title="My account" subtitle="Name, login numbers, alerts on this phone" onPress={() => nav.navigate('MyAccount')} last />
            </Card>

            <SectionTitle section="settings">Appearance</SectionTitle>
            <Card>
                <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[{ value: 'system', label: 'Phone setting' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                />
            </Card>

            <SectionTitle section="platform">App</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Version" value={pkg.version} last />
            </Card>

            <Button title="Log out" kind="dangerSoft" icon="logout" style={{ marginTop: spacing.xl }} onPress={() => setConfirm(true)} />

            <ConfirmSheet
                visible={confirm}
                onClose={() => setConfirm(false)}
                title="Log out?"
                message="You will need your mobile number and an OTP to log in again."
                confirmLabel="Log out"
                danger
                onConfirm={async () => { await logout(); }}
            />
        </Screen>
    );
}
