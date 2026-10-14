import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, Avatar, KeyValue, Button, ListRow, Badge } from '../../components/ui';
import { Hero } from '../../components/blocks';
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
    const mode = useThemeStore((s) => s.mode);
    const setMode = useThemeStore((s) => s.setMode);

    return (
        <Screen tabScreen title="More" subtitle="Account and platform">
            <Hero
                section="platform"
                leading={<Avatar section="platform" name={admin?.name || admin?.email || 'Superadmin'} size={58} />}
                title={admin?.name || 'Superadmin'}
                subtitle={admin?.email || 'Platform owner'}
            >
                <Badge label="Superadmin" tone="primary" icon="crown" />
            </Hero>

            <SectionTitle section="alerts">Alerts and messages</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="alerts" icon="bell" title="Alerts inbox" subtitle="Late orders, unpaid bills, problems" onPress={() => nav.navigate('Inbox')} />
                <ListRow section="platform" icon="megaphone" title="Messages to owners" subtitle="Write to all shop owners" onPress={() => nav.navigate('OwnerMessages')} />
                <ListRow section="catalog" icon="message" title="Alert SMS" subtitle="SMS to your phone and what they cost" onPress={() => nav.navigate('AlertSettings')} />
                <ListRow section="settings" icon="tune" title="Notification rules" subtitle="How each event is delivered" onPress={() => nav.navigate('NotificationRules')} last />
            </Card>

            <SectionTitle section="platform">Platform</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
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
