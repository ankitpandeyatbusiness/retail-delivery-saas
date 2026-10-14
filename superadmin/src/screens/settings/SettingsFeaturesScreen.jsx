import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Switch } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { FEATURES, FEATURE_GROUPS } from '../../utils/settings';

// The on / off switches of the customer app: veg toggle, veg dot, ratings, tips, scheduling...
export default function SettingsFeaturesScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['features']);
    const known = ed.options?.FEATURE_KEYS || [];

    return (
        <SettingsPage ed={ed} title="App features" subtitle={name} preview>
            {ed.ready ? FEATURE_GROUPS.map((g) => {
                const keys = g.keys.filter((k) => known.includes(k));
                if (!keys.length) return null;
                return (
                    <Group key={g.title} title={g.title} section="settings" flush>
                        {keys.map((k, i) => (
                            <Switch
                                key={k}
                                title={FEATURES[k]?.[0] || k}
                                subtitle={FEATURES[k]?.[1]}
                                value={!!ed.draft.features[k]}
                                onValueChange={(v) => ed.set('features', k, v)}
                                last={i === keys.length - 1}
                            />
                        ))}
                    </Group>
                );
            }) : null}
        </SettingsPage>
    );
}
