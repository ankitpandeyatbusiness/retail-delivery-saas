import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, ColorField, Hint } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices } from '../../utils/settings';

const COLOR_LABELS = {
    primary: ['Main colour', 'Buttons, header and highlights'],
    primaryLight: ['Light shade', 'Soft backgrounds'],
    primaryDark: ['Dark shade', 'Pressed buttons'],
    background: ['Background', 'Screen background'],
    text: ['Text', 'Main text colour'],
    error: ['Alert colour', 'Errors and warnings'],
    accent: ['Accent colour', 'Offer ribbons and highlights (second colour)'],
};

export default function SettingsBrandScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['brand']);
    const colors = ed.draft?.brand?.colors || {};
    const setColor = (k, v) => {
        const next = { ...colors };
        if (v) next[k] = v; else delete next[k];
        ed.set('brand', 'colors', next);
    };

    return (
        <SettingsPage ed={ed} title="Brand and look" subtitle={name} preview>
            {ed.ready ? (
                <>
                    <Group title="Colours" section="settings" hint="The customer app uses these everywhere. Leave one empty to use the colour found from the logo.">
                        {(ed.options.COLOR_KEYS || []).map((k, i, a) => (
                            <ColorField
                                key={k}
                                label={COLOR_LABELS[k]?.[0] || k}
                                hint={COLOR_LABELS[k]?.[1]}
                                value={colors[k]}
                                onChange={(v) => setColor(k, v)}
                                last={i === a.length - 1}
                            />
                        ))}
                    </Group>
                    <Group
                        title="Look of the app"
                        section="settings"
                        hint="Bold keeps the brand-colour header. Fresh, Cream and Midnight set the background, cards and text colours, and use the main colour as an accent."
                    >
                        <Choice label="Look" options={choices('look', ed.options.LOOKS)} value={ed.draft.brand.look} onChange={(v) => ed.set('brand', 'look', v)} />
                        <Choice label="Home header" options={choices('headerStyle', ed.options.HEADER_STYLES)} value={ed.draft.brand.headerStyle} onChange={(v) => ed.set('brand', 'headerStyle', v)} />
                        <Choice label="Categories" options={choices('categoryStyle', ed.options.CATEGORY_STYLES)} value={ed.draft.brand.categoryStyle} onChange={(v) => ed.set('brand', 'categoryStyle', v)} />
                        <Choice label="Filters" options={choices('filterStyle', ed.options.FILTER_STYLES)} value={ed.draft.brand.filterStyle} onChange={(v) => ed.set('brand', 'filterStyle', v)} />
                        <Choice label="Bottom tabs" options={choices('tabBarStyle', ed.options.TAB_BAR_STYLES)} value={ed.draft.brand.tabBarStyle} onChange={(v) => ed.set('brand', 'tabBarStyle', v)} />
                        <Choice label="Animations" options={choices('motion', ed.options.MOTION_LEVELS)} value={ed.draft.brand.motion} onChange={(v) => ed.set('brand', 'motion', v)} last />
                        <Hint>Animations: Full is the premium feel. Subtle keeps only fades. Off is for very old phones.</Hint>
                    </Group>
                    <Group title="Style" section="settings">
                        <Choice label="Font style" options={choices('font', ed.options.FONT_STYLES)} value={ed.draft.brand.fontStyle} onChange={(v) => ed.set('brand', 'fontStyle', v)} />
                        <Choice label="Button shape" options={choices('shape', ed.options.BUTTON_SHAPES)} value={ed.draft.brand.buttonShape} onChange={(v) => ed.set('brand', 'buttonShape', v)} last />
                        <Hint>Colours can also be picked from the logo: Shop → Branding.</Hint>
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
