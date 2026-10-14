import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, TextField } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices, nameOf } from '../../utils/settings';

// The words the customer app uses, and its language.
export default function SettingsLabelsScreen() {
    const { shopId, name } = useRoute().params;
    // a text that is cleared falls back to the default instead of becoming an empty button
    const ed = useSettingsEditor(shopId, ['labels'], {
        fixPatches: (patches, { defaults }) => {
            if (!patches.labels) return patches;
            const labels = { ...patches.labels };
            for (const [k, v] of Object.entries(labels)) {
                if (typeof v === 'string' && !v.trim() && defaults?.labels?.[k] !== undefined) labels[k] = defaults.labels[k];
            }
            return { ...patches, labels };
        },
    });
    const keys = ed.options?.LABEL_KEYS || [];

    return (
        <SettingsPage ed={ed} title="Words and language" subtitle={name} preview>
            {ed.ready ? (
                <>
                    <Group title="Language" section="people">
                        <Choice options={choices('language', ed.options.LANGUAGES)} value={ed.draft.labels.language} onChange={(v) => ed.set('labels', 'language', v)} last />
                    </Group>
                    <Group title="Button and message texts" section="people" hint="Up to 60 characters. Leave one empty to use the standard text.">
                        {keys.map((k, i) => (
                            <TextField
                                key={k}
                                label={nameOf('label', k)}
                                value={ed.draft.labels[k]}
                                maxLength={60}
                                onChange={(v) => ed.set('labels', k, v)}
                                last={i === keys.length - 1}
                            />
                        ))}
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
