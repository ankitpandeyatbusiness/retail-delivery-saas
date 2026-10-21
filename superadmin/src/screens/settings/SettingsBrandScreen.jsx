import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, radius, font } from '../../theme';
import { Button } from '../../components/ui';
import Icon from '../../components/Icon';
import { ConfirmSheet, toast } from '../../components/feedback';
import { updateShop, logoColors } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, ColorField, Hint } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices, isHex, RECOMMENDED_LOOK } from '../../utils/settings';
import { bestPalette, readableOnWhiteText, PALETTE_LABELS } from '../../utils/palette';

const SHADES = ['primary', 'primaryLight', 'primaryDark'];   // the three colours a logo can supply
// only real #RRGGBB colours are kept: an empty or half-typed one must never be sent (the server would say it "must look like #RRGGBB")
const onlyHex = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => isHex(v)));
const pick = (o) => Object.fromEntries(SHADES.filter((k) => isHex(o?.[k])).map((k) => [k, o[k]]));

function Swatches({ label, colours }) {
    const t = useTheme();
    return (
        <View style={{ flex: 1 }}>
            <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '800', marginBottom: 6 }}>{label}</Text>
            <View style={{ flexDirection: 'row' }}>
                {SHADES.map((k) => (
                    <View key={k} style={{ width: 34, height: 34, borderRadius: 10, marginRight: 6, backgroundColor: colours[k] || 'transparent', borderWidth: colours[k] ? 0 : 1, borderStyle: 'dashed', borderColor: t.border }} />
                ))}
            </View>
        </View>
    );
}

const COLOR_LABELS = {
    primary: ['Main colour', 'Buttons, header and highlights'],
    primaryLight: ['Light shade', 'Soft backgrounds'],
    primaryDark: ['Dark shade', 'Pressed buttons'],
    background: ['Background', 'Screen background'],
    text: ['Text', 'Main text colour'],
    error: ['Alert colour', 'Errors and warnings'],
    accent: ['Accent colour', "A second colour for the OFFER tags on dish photos (like '20% OFF') in the Fresh, Cream and Midnight looks. Buttons and headers keep the main colour."],
};

export default function SettingsBrandScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['brand']);
    const colors = ed.draft?.brand?.colors || {};
    const [reading, setReading] = useState(false);
    const [confirm, setConfirm] = useState(false);

    // Two sources of colour: the LOGO's (saved on the shop) and the colours typed in here (the panel's own).
    // Only one may exist. A colour counts as "own" when it differs from the logo's, or is saved as the panel's.
    const logo = pick(ed.rec?.tenant?.colors);
    const savedOwn = pick(ed.rec?.tenant?.settings?.brand?.colors);
    const own = Object.fromEntries(SHADES.filter((k) => isHex(colors[k]) && (colors[k] !== logo[k] || savedOwn[k])).map((k) => [k, colors[k]]));
    const conflict = Object.keys(logo).length > 0 && Object.keys(own).length > 0;

    // The best colours for the main colour in use (the logo's, or the one picked here)
    const logoOnly = Object.keys(logo).length > 0 && Object.keys(own).length === 0;
    const mainNow = logoOnly ? logo.primary : (isHex(colors.primary) ? colors.primary : logo.primary);
    const best = bestPalette(mainNow);
    const resetBest = () => {
        const next = onlyHex(colors);
        // with the logo as the source its own three colours are left alone; everything else is set
        const keys = logoOnly ? ['background', 'text', 'error', 'accent'] : ['primary', 'primaryLight', 'primaryDark', 'background', 'text', 'error', 'accent'];
        keys.forEach((k) => { next[k] = best[k]; });
        ed.set('brand', 'colors', next);
        toast('Colours set to the best combination');
    };

    // keep the logo's colours: take the typed colours out of the form
    const useLogo = () => {
        const next = onlyHex(colors);
        SHADES.forEach((k) => delete next[k]);
        ed.set('brand', 'colors', next);
    };
    // keep the typed colours: take the logo's colours off the shop (they were only a suggestion)
    const dropLogo = async () => {
        try {
            await updateShop(shopId, { colors: { primary: '', primaryLight: '', primaryDark: '' } });
            await useShopStore.getState().load(shopId, { quiet: true });
            toast("The logo's colours were removed. Your own colours stay.");
        } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };
    const setColor = (k, v) => {
        const next = onlyHex(colors);
        if (v) next[k] = v; else delete next[k];
        ed.set('brand', 'colors', next);
    };

    // one tap: read the logo, make its three colours this shop's colours, and drop the logo's separate copy so only one source is left.
    // The colours land in the form; Save keeps them.
    const logoUrl = ed.rec?.tenant?.logo;
    const iconUrl = ed.rec?.appIcon && ed.rec.appIcon !== logoUrl ? ed.rec.appIcon : '';   // the app icon, when it is a different picture from the logo
    const adopt = async (url, what) => {
        if (reading) return;
        setReading(true);
        try {
            const r = await logoColors(shopId, url);
            if (!r.suggested) { toast(r.message || `No usable colour in this ${what}`, 'error'); return; }
            if (Object.keys(logo).length) {
                await updateShop(shopId, { colors: { primary: '', primaryLight: '', primaryDark: '' } });
                await useShopStore.getState().load(shopId, { quiet: true });
            }
            const next = onlyHex(colors);
            SHADES.forEach((k) => { if (isHex(r.suggested[k])) next[k] = r.suggested[k]; });
            ed.set('brand', 'colors', next);
            toast(`The ${what}'s colours are in. Tap Save to keep them.`);
        } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setReading(false); }
    };

    return (
        <SettingsPage ed={ed} title="Brand and look" subtitle={name} preview saveBlocked={conflict ? 'Remove one colour source first' : ''}>
            {ed.ready ? (
                <>
                    {conflict ? (
                        <View style={{ backgroundColor: t.dangerSoft, borderColor: t.danger, borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Icon name="warning" size={22} color={t.danger} />
                                <Text style={{ color: t.danger, fontSize: font.md, fontWeight: '900', marginLeft: spacing.sm, flex: 1 }}>Two colour sources are selected</Text>
                            </View>
                            <Text style={{ color: t.text, fontSize: font.sm, marginTop: spacing.sm, lineHeight: 19 }}>
                                This shop has the colours from its <Text style={{ fontWeight: '800' }}>logo</Text> and colours you picked yourself.
                                The app can use only one of them. Remove one to continue.
                            </Text>
                            <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
                                <Swatches label="FROM THE LOGO" colours={logo} />
                                <Swatches label="PICKED BY YOU" colours={own} />
                            </View>
                            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                                <Button style={{ flex: 1 }} small kind="outline" title="Use the logo's" onPress={useLogo} />
                                <Button style={{ flex: 1 }} small kind="danger" title="Keep mine" onPress={() => setConfirm(true)} />
                            </View>
                            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>
                                "Use the logo's" clears the colours you picked. "Keep mine" removes the logo's colours from the shop.
                            </Text>
                        </View>
                    ) : null}
                    <ConfirmSheet
                        visible={confirm}
                        onClose={() => setConfirm(false)}
                        title="Remove the logo's colours?"
                        message="The shop will use only the colours you picked. You can read the colours from the logo again later, from Branding."
                        confirmLabel="Remove logo colours"
                        danger
                        onConfirm={dropLogo}
                    />
                    {!conflict ? (
                        <View style={{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md }}>
                            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '900' }}>Best colours for this shop</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2, lineHeight: 19 }}>
                                {logoOnly ? "Chosen from the logo's main colour." : 'Chosen from the main colour you picked.'} The alert, accent, text and page colours are set so everything stays readable and matches.
                            </Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md }}>
                                {PALETTE_LABELS.map(([k, label]) => (
                                    <View key={k} style={{ alignItems: 'center', marginRight: spacing.md, marginBottom: spacing.sm }}>
                                        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: best[k], borderWidth: 1, borderColor: t.border }} />
                                        <Text style={{ color: t.muted, fontSize: 10, marginTop: 4 }}>{label}</Text>
                                    </View>
                                ))}
                            </View>
                            {!readableOnWhiteText(mainNow) ? (
                                <Text style={{ color: t.warn, fontSize: font.xs, marginBottom: spacing.sm }}>
                                    The main colour is a little too light for white text, so the best combination darkens it slightly.
                                </Text>
                            ) : null}
                            <Button small kind="soft" title="Reset to best colours" onPress={resetBest} />
                        </View>
                    ) : null}
                    {logoUrl || iconUrl ? (
                        <View style={{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md }}>
                            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '900' }}>Take the colours from a picture</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2, marginBottom: spacing.md, lineHeight: 19 }}>
                                Reads the main, light and dark colour from the shop's logo or app icon and uses them for the app. One tap, then Save.
                            </Text>
                            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                                <Button style={{ flex: 1 }} small kind="soft" icon="palette" title="From the logo" loading={reading} onPress={() => adopt(logoUrl, 'logo')} disabled={!logoUrl} />
                                {iconUrl ? <Button style={{ flex: 1 }} small kind="soft" icon="palette" title="From the app icon" loading={reading} onPress={() => adopt(iconUrl, 'app icon')} /> : null}
                            </View>
                        </View>
                    ) : null}
                    <Group title="Colours" section="settings" hint="The customer app uses these everywhere. Colours from the logo and colours you pick here cannot both be used: clearing a colour here goes back to the logo's.">
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
                        hint="The light theme and the dark theme are chosen separately: customers see the light one in light mode and the dark one in dark mode (they pick, or follow their phone). Bold keeps the brand-colour header; the others set the page, card and text colours."
                    >
                        <Choice label="Light theme" options={choices('look', ed.options.LIGHT_LOOKS || [])} value={ed.draft.brand.lightLook} onChange={(v) => ed.set('brand', 'lightLook', v)} />
                        <Choice label="Dark theme" options={choices('look', ed.options.DARK_LOOKS || [])} value={ed.draft.brand.darkLook} onChange={(v) => ed.set('brand', 'darkLook', v)} />
                        <Choice label="Home header" options={choices('headerStyle', ed.options.HEADER_STYLES)} value={ed.draft.brand.headerStyle} onChange={(v) => ed.set('brand', 'headerStyle', v)} />
                        <Choice label="Categories" options={choices('categoryStyle', ed.options.CATEGORY_STYLES)} value={ed.draft.brand.categoryStyle} onChange={(v) => ed.set('brand', 'categoryStyle', v)} />
                        <Choice label="Shop location" options={choices('locationStyle', ed.options.LOCATION_STYLES || [])} value={ed.draft.brand.locationStyle} onChange={(v) => ed.set('brand', 'locationStyle', v)} />
                        <Choice label="Filters" options={choices('filterStyle', ed.options.FILTER_STYLES)} value={ed.draft.brand.filterStyle} onChange={(v) => ed.set('brand', 'filterStyle', v)} />
                        <Choice label="Bottom tabs" options={choices('tabBarStyle', ed.options.TAB_BAR_STYLES)} value={ed.draft.brand.tabBarStyle} onChange={(v) => ed.set('brand', 'tabBarStyle', v)} />
                        <Choice label="Animations" options={choices('motion', ed.options.MOTION_LEVELS)} value={ed.draft.brand.motion} onChange={(v) => ed.set('brand', 'motion', v)} last />
                        <Hint>Animations: Full is the premium feel. Subtle keeps only fades. Off is for very old phones.</Hint>
                        <View style={{ marginTop: spacing.sm }}>
                            <Button
                                small
                                kind="soft"
                                title="Reset look to recommended"
                                onPress={() => {
                                    Object.entries(RECOMMENDED_LOOK).forEach(([k, v]) => ed.set('brand', k, v));
                                    toast('Look reset to the recommended settings');
                                }}
                            />
                        </View>
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
