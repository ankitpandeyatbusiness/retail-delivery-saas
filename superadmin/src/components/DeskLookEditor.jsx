// The look of the DESKTOP website, in a shop's Brand and look settings. A switch, "Follow the Mobile App UI" (on unless the shop set its desktop look apart): while on, the
// website copies the mobile look exactly. Turning it off starts the desktop look as a copy of the mobile one, and each setting can then be changed on its own: the colours
// (with the same ready-made gradient combinations as the mobile look), the light and dark theme, the header, the categories, the location bar, the filter popup, the top bar
// and the dish card shape. It edits `brand.desktop`; the server turns that into the website's look (services/tenantConfigService.js).
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, spacing, radius, font } from '../theme';
import { Group, Choice, ColorField, Hint, Switch } from './settingsForm';
import { toast } from './feedback';
import { choices, isHex } from '../utils/settings';
import { bestPalette, comboColours, recommendedCombos, shadesOf } from '../utils/palette';
import { GRADIENT_COMBOS, COMBO_TABS, SWATCH_GROUPS, ACCENT_GROUPS, BG_GROUPS, TEXT_GROUPS, ALERT_GROUPS } from '../utils/colorLibrary';

const COLOR_NAMES = {
    primary: ['Main colour', 'Buttons, header and highlights'], primaryLight: ['Light shade', 'The start of the header and button gradients'],
    primaryDark: ['Dark shade', 'The end of the gradients'], background: ['Background', 'Page background'], text: ['Text', 'Main text colour'],
    error: ['Alert colour', 'Errors and warnings'], accent: ['Accent colour', 'Offer tags on dish photos'],
};
const KEYS = ['primary', 'primaryLight', 'primaryDark', 'background', 'text', 'error', 'accent'];
const onlyHex = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => isHex(v)));
const SAME = '';   // "same as the mobile app" for a choice

function ComboTile({ combo, on, onPress }) {
    const t = useTheme();
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={{ width: '48%', marginBottom: spacing.md, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? t.text : t.border, backgroundColor: t.surface, padding: 6 }}>
            <LinearGradient colors={[combo.light, combo.primary, combo.dark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 54, borderRadius: radius.sm, justifyContent: 'flex-end', padding: 6 }}>
                <View style={{ flexDirection: 'row' }}>
                    {[combo.light, combo.primary, combo.dark, combo.accent].map((c, i) => <View key={i} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)', marginRight: 4 }} />)}
                </View>
            </LinearGradient>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: font.sm, fontWeight: '800', marginTop: 6, marginLeft: 2 }}>{combo.name}</Text>
        </Pressable>
    );
}

export default function DeskLookEditor({ ed }) {
    const t = useTheme();
    const b = ed.draft.brand || {};
    const d = b.desktop || {};
    const follow = d.follow !== false;
    const [tab, setTab] = useState('All');
    const setD = (patch) => ed.set('brand', 'desktop', { ...d, ...patch });
    const mobileColours = onlyHex(b.colors);

    // follow ON -> the website copies the mobile look. Turning it OFF starts the desktop look as a copy of the mobile one, to change from there.
    const toggleFollow = (on) => {
        if (on) { setD({ follow: true }); return; }
        setD({
            follow: false,
            colors: onlyHex(d.colors).primary ? onlyHex(d.colors) : mobileColours,
            lightLook: d.lightLook || b.lightLook, darkLook: d.darkLook || b.darkLook,
            headerStyle: d.headerStyle || b.headerStyle, tabBarStyle: d.tabBarStyle || b.tabBarStyle, categoryStyle: d.categoryStyle || b.categoryStyle,
            categoryScroll: d.categoryScroll !== undefined ? d.categoryScroll : b.categoryScroll === true,
            filterStyle: d.filterStyle || b.filterStyle, locationStyle: d.locationStyle || b.locationStyle,
        });
        toast('The desktop website now has its own look, copied from the mobile app to start with');
    };

    const colors = onlyHex(d.colors);
    const mainNow = colors.primary || mobileColours.primary;
    const setColor = (k, v) => {
        const next = { ...colors };
        if (v) next[k] = v; else delete next[k];
        if (k === 'primary' && v && isHex(v)) Object.assign(next, bestPalette(v));   // the main colour decides the rest (change any of them after)
        setD({ colors: next });
    };
    const applyCombo = (c) => { setD({ colors: { ...colors, ...comboColours(c) } }); toast(`${c.name} colours are in for the website. Tap Save to keep them.`); };
    const isOn = (c) => colors.primary === c.primary && colors.primaryLight === c.light && colors.primaryDark === c.dark;
    const tabbed = tab === 'All' ? GRADIENT_COMBOS : GRADIENT_COMBOS.filter((c) => c.group === tab);
    const suggestions = recommendedCombos(mainNow);
    const fieldProps = (k) => {
        if (k === 'primaryLight' || k === 'primaryDark') return { suggest: shadesOf(mainNow), groups: SWATCH_GROUPS };
        if (k === 'background') return { groups: BG_GROUPS };
        if (k === 'text') return { groups: TEXT_GROUPS };
        if (k === 'error') return { groups: ALERT_GROUPS };
        if (k === 'accent') return { groups: ACCENT_GROUPS };
        return { groups: SWATCH_GROUPS };
    };
    const opt = (group, ids) => [{ value: SAME, label: 'Same as mobile' }, ...choices(group, ids || [])];
    const pick = (k) => (v) => setD({ [k]: v === SAME ? undefined : v });

    return (
        <>
            <Group title="Desktop website" section="settings" hint="Customers on a computer see the website. By default it looks exactly like the mobile app. Turn the switch off to design it separately.">
                <Switch
                    title="Follow the Mobile App UI"
                    subtitle={follow ? 'The website copies everything chosen for the mobile app: colours, header, categories, cards, filters.' : 'The website has its own look. Turn this on to copy the mobile app again (your desktop choices are kept).'}
                    value={follow}
                    onValueChange={toggleFollow}
                    last
                />
            </Group>
            {follow ? (
                <Hint>While this is on, nothing below can be changed. Change the Mobile app tab and the website follows it.</Hint>
            ) : (
                <>
                    <Group title="Look of the website" section="settings" hint="Anything left on 'Same as mobile' follows the mobile app.">
                        <Choice label="Light theme" options={opt('look', ed.options.LIGHT_LOOKS)} value={d.lightLook || SAME} onChange={pick('lightLook')} />
                        <Choice label="Dark theme" options={opt('look', ed.options.DARK_LOOKS)} value={d.darkLook || SAME} onChange={pick('darkLook')} />
                        <Choice label="Home header" options={opt('headerStyle', ed.options.HEADER_STYLES)} value={d.headerStyle || SAME} onChange={pick('headerStyle')} />
                        <Choice label="Categories" options={opt('categoryStyle', ed.options.CATEGORY_STYLES)} value={d.categoryStyle || SAME} onChange={pick('categoryStyle')} />
                        <Switch title="Categories scroll sideways" subtitle="One medium-size row you scroll sideways, instead of the big grid." value={d.categoryScroll === true} onValueChange={(v) => setD({ categoryScroll: v })} />
                        <Choice label="Shop location" options={opt('locationStyle', ed.options.LOCATION_STYLES)} value={d.locationStyle || SAME} onChange={pick('locationStyle')} />
                        <Choice label="Filters" options={opt('filterStyle', ed.options.FILTER_STYLES)} value={d.filterStyle || SAME} onChange={pick('filterStyle')} />
                        <Choice label="Top bar" options={opt('tabBarStyle', ed.options.TAB_BAR_STYLES)} value={d.tabBarStyle || SAME} onChange={pick('tabBarStyle')} />
                        <Choice label="Dish cards" options={opt('cardStyle', ed.options.CARD_STYLES)} value={d.cardStyle || SAME} onChange={pick('cardStyle')} last />
                    </Group>

                    <View style={{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md }}>
                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '900' }}>Recommended for the website</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2, marginBottom: spacing.md, lineHeight: 19 }}>Six looks worked out from the website's main colour. Tap one and every colour is set.</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                            {suggestions.map((c) => <ComboTile key={c.name} combo={c} on={isOn(c)} onPress={() => applyCombo(c)} />)}
                        </View>
                    </View>
                    <View style={{ backgroundColor: t.surface, borderColor: t.border, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md }}>
                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '900' }}>Colour combinations</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2, marginBottom: spacing.sm, lineHeight: 19 }}>Ready-made colour runs for the website's headers and buttons.</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
                            {COMBO_TABS.map((x) => (
                                <Pressable key={x} onPress={() => setTab(x)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1, borderColor: tab === x ? t.text : t.border, backgroundColor: tab === x ? t.text : 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 6, marginBottom: 6 }}>
                                    <Text style={{ color: tab === x ? t.surface : t.text, fontSize: font.xs, fontWeight: '800' }}>{x}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                            {tabbed.map((c) => <ComboTile key={c.name} combo={c} on={isOn(c)} onPress={() => applyCombo(c)} />)}
                        </View>
                    </View>
                    <Group title="Website colours" section="settings" hint="Picking the main colour sets the others to match. You can change each one after.">
                        {KEYS.map((k, i) => (
                            <ColorField key={k} label={COLOR_NAMES[k][0]} hint={COLOR_NAMES[k][1]} value={colors[k]} onChange={(v) => setColor(k, v)} last={i === KEYS.length - 1} {...fieldProps(k)} />
                        ))}
                    </Group>
                </>
            )}
        </>
    );
}
