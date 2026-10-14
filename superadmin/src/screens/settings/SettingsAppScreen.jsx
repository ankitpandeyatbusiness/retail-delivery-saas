import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, TextField, Switch, Hint } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';

export default function SettingsAppScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['app', 'notifications']);

    return (
        <SettingsPage ed={ed} title="App version and alerts" subtitle={name}>
            {ed.ready ? (
                <>
                    <Group title="Minimum app version" section="platform">
                        <TextField
                            label="Oldest version allowed"
                            value={ed.draft.app.minVersion}
                            onChange={(v) => ed.set('app', 'minVersion', v.replace(/[^\d.]/g, ''))}
                            placeholder="e.g. 1.2.0"
                            keyboardType="decimal-pad"
                            autoCapitalize="none"
                            last
                        />
                        <Hint>Customers on an older app are asked to update before they can continue. Leave empty for no minimum.</Hint>
                    </Group>
                    <Group title="SMS alerts" section="alerts" flush>
                        <Switch
                            title="Key-event SMS"
                            subtitle="New order, bill and order-step messages. These use the shop's SMS wallet."
                            value={!!ed.draft.notifications.smsAlerts}
                            onValueChange={(v) => ed.set('notifications', 'smsAlerts', v)}
                            last
                        />
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
