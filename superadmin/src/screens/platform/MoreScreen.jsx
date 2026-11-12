import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, KeyValue, Button, ListRow } from '../../components/ui';
import { SearchBar, Segmented } from '../../components/inputs';
import SearchResults from '../../components/SearchResults';
import { HandleBar } from '../../components/HandledBits';
import { fetchMoreAttention } from '../../api/handledApi';
import ProfileCard from '../../components/ProfileCard';
import { ConfirmSheet } from '../../components/feedback';
import { useAuthStore } from '../../store/useAuthStore';
import { useThemeStore } from '../../store/useThemeStore';
import pkg from '../../../package.json';

// The More tab: your own account and the platform's controls. Everything about shops, orders and money lives in its own tab.
export default function MoreScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const admin = useAuthStore((s) => s.admin);
    const logout = useAuthStore((s) => s.logout);
    const [confirm, setConfirm] = useState(false);
    const [q, setQ] = useState('');
    const [att, setAtt] = useState(null);
    const load = useCallback(() => { fetchMoreAttention().then(setAtt).catch(() => { }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const mode = useThemeStore((s2) => s2.mode);
    const setMode = useThemeStore((s2) => s2.setMode);
    const go = (screen) => () => nav.navigate(screen);

    return (
        <Screen tabScreen title="More" subtitle="Account and platform" onRefresh={async () => { load(); }}>
            <View style={{ marginBottom: spacing.lg }}><SearchBar value={q} onChangeText={setQ} placeholder="Search a screen, setting or shop" /></View>
            {q.trim() ? <SearchResults q={q} /> : (
                <>
                    <ProfileCard name={admin?.name} subtitle={admin?.email} />

                    {att && (att.items.length || att.handled.length) ? (
                        <>
                            <SectionTitle section="alerts">Needs attention{att.counts.total ? ` · ${att.counts.total}` : ''}</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {att.items.map((it, i) => (
                                    <View key={it.key} style={{ borderBottomWidth: i === att.items.length - 1 && !att.handled.length ? 0 : 0.5, borderBottomColor: t.border, paddingBottom: it.kind ? spacing.md : 0 }}>
                                        <ListRow section={it.level === 'bad' ? 'alerts' : 'catalog'} icon={it.level === 'bad' ? 'warning' : 'clock'} title={it.title} subtitle={it.hint} onPress={go(it.screen)} last />
                                        {it.kind ? <HandleBar kind={it.kind} refId={it.refId} title={it.title} onChanged={load} /> : null}
                                    </View>
                                ))}
                                {att.handled.map((it) => (
                                    <View key={it.key} style={{ paddingVertical: spacing.md }}>
                                        <Text style={{ color: t.muted, fontWeight: '700', fontSize: font.sm }}>{it.title}</Text>
                                        <HandleBar kind={it.kind} refId={it.refId} mark={it.mark} onChanged={load} />
                                    </View>
                                ))}
                                {!att.items.length ? <ListRow section="riders" icon="ok" title="All clear" subtitle="Everything else is marked as handled." last /> : null}
                            </Card>
                        </>
                    ) : null}

                    <SectionTitle section="alerts">Rules and SMS</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="money" icon="bolt" title="Move shops to plans" subtitle="Give every existing shop Pro, free for 30 days (preview first, backup first)" onPress={go('PlanMigration')} />
                        <ListRow section="money" icon="star" title="Plans overview" subtitle="Who is on which plan, plans ending soon, held payments and bank disputes" onPress={go('PlanOverview')} />
                        <ListRow section="money" icon="star" title="Plan coupons" subtitle="Offers for plan payments: make one, send a push to the shops that can use it" onPress={go('PlanCoupons')} />
                        <ListRow section="money" icon="star" title="Plan defaults" subtitle="Growth and Pro prices, Partner fee, free days, GST, branch add-on" onPress={go('PlanDefaults')} />
                        <ListRow section="settings" icon="tune" title="Notification rules" subtitle="How each event is delivered" onPress={go('NotificationRules')} />
                        <ListRow section="catalog" icon="message" title="Alert SMS" subtitle="SMS to your phone and what they cost" onPress={go('AlertSettings')} />
                        <ListRow section="catalog" icon="message" title="SMS and DLT setup" subtitle="MSG91 key, sender, template IDs, send a test" onPress={go('SmsSetup')} />
                        <ListRow section="money" icon="chart" title="Owner report settings" subtitle="Monthly report email and the comparison shown to owners" onPress={go('InsightsSettings')} last />
                    </Card>

                    <SectionTitle section="platform">Platform controls</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="catalog" icon="palette" title="Login backgrounds" subtitle="The picture behind the desktop website's login page, one set per business type" onPress={go('LoginBackgrounds')} />
                        <ListRow section="alerts" icon="tool" title="Maintenance" subtitle="Pause every shop's app for an upgrade" onPress={go('Maintenance')} />
                        <ListRow section="platform" icon="tool" title="Server setup" subtitle="What is set on the server and what is missing, with what each is for" onPress={go('ServerSetup')} />
                        <ListRow section="settings" icon="bolt" title="System and backups" subtitle="Database, SMS, nightly jobs, backups" onPress={go('System')} last />
                    </Card>

                    <SectionTitle section="money">Records</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="platform" icon="notes" title="Audit log" subtitle="Who changed what, everywhere" onPress={go('AuditLog')} />
                        <ListRow section="money" icon="copy" title="Export data" subtitle="Orders, invoices, customers as Excel sheets" onPress={go('Exports')} last />
                    </Card>

                    <SectionTitle section="shops">Me</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <ListRow section="shops" icon="user" title="My account" subtitle="Name, login numbers, alerts on this phone" onPress={go('MyAccount')} />
                        <ListRow section="settings" icon="crown" title="Superadmin team" subtitle="Add, revoke or restore superadmins" onPress={go('Team')} />
                        <ListRow section="settings" icon="lock" title="App lock" subtitle="PIN, fingerprint or face when the panel opens" onPress={go('AppLock')} last />
                    </Card>

                    <SectionTitle section="settings">Appearance</SectionTitle>
                    <Card>
                        <Segmented
                            value={mode}
                            onChange={(m) => setTimeout(() => setMode(m), 280)}
                            options={[{ value: 'system', label: 'Phone setting' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                        />
                    </Card>

                    <SectionTitle section="platform">App</SectionTitle>
                    <Card style={{ paddingVertical: 0 }}>
                        <KeyValue label="Version" value={pkg.version} last />
                    </Card>

                    <Button title="Log out" kind="dangerSoft" icon="logout" style={{ marginTop: spacing.xl }} onPress={() => setConfirm(true)} />
                </>
            )}

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
