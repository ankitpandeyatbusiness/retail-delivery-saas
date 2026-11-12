import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SETUP_STEPS, goSetupStep } from '../utils/setupFlow';
import { useTheme, spacing, radius, font, tint } from '../theme';
import { Screen } from './layout';
import { Card, Button, Badge, SectionTitle } from './ui';
import { Loading, ErrorBox } from './feedback';
import Icon from './Icon';
import { previewFrom } from '../utils/settings';
import PhonePreview from './preview/PhonePreview';
import DesktopPreview from './preview/DesktopPreview';

// the pinned preview: the phone, or the website as it looks on a computer (drawn wide and scaled to fit this screen)
function PreviewTabs({ phone }) {
    const t = useTheme();
    const [mode, setMode] = useState('phone');
    return (
        <View>
            <View style={{ flexDirection: 'row', marginBottom: spacing.xs }}>
                {[['phone', 'Phone'], ['desktop', 'Desktop view']].map(([k, l]) => (
                    <Pressable key={k} onPress={() => setMode(k)} style={{ paddingHorizontal: 14, height: 30, borderRadius: 15, backgroundColor: mode === k ? t.text : 'transparent', borderWidth: 1, borderColor: mode === k ? t.text : t.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                        <Text style={{ color: mode === k ? t.surface : t.text, fontSize: font.xs, fontWeight: '800' }}>{l}</Text>
                    </Pressable>
                ))}
            </View>
            {mode === 'phone' ? <PhonePreview config={phone} scale={0.46} collapsible /> : <DesktopPreview config={phone} />}
        </View>
    );
}

const TAB_ICON = { home: 'home', search: 'search', offers: 'coupon', orders: 'receipt', profile: 'user' };
const BLOCK_ICON = {
    search: 'search', banner: 'banner', categories: 'menu', filters: 'tune', offers: 'coupon',
    bestsellers: 'star', festival: 'sparkle', combos: 'box', new_arrivals: 'bolt', items: 'food',
};
const SHAPE = { rounded: 12, pill: 99, square: 3 };

// The live phone: a working copy of the customer app (see components/preview/PhonePreview.jsx).
export function AppPreview({ config, scale = 0.7, collapsible, screens = true }) {
    if (!config) return null;
    return <PhonePreview config={config} scale={scale} collapsible={collapsible} screens={screens} />;
}

/*
 * The frame of every settings screen: header, loading and error states, the validation messages from the server,
 * the optional live preview, and the Save bar.
 */
export function SettingsPage({ ed, title, subtitle, children, preview = false, saveBlocked = '' }) {
    const t = useTheme();
    const nav = useNavigation();
    const params = useRoute().params || {};
    const setup = params.setup;   // { i }: this screen is step i of the guided setup of a new shop
    const next = () => goSetupStep(nav, params.shopId, params.name, setup.i + 1);
    const phone = preview && ed.ready ? previewFrom(ed.preview || ed.rec?.resolved, ed.draft) : null;
    const footer = setup ? (
        <View style={{ flexDirection: 'row' }}>
            <Button title="Skip" kind="outline" onPress={next} style={{ flex: 1, marginRight: spacing.sm }} />
            <Button
                title={ed.dirty ? 'Save and next' : 'Next'}
                icon="next"
                loading={ed.saving}
                disabled={!!saveBlocked}
                onPress={async () => { if (ed.dirty) { const ok = await ed.save({ stay: true }); if (!ok) return; } next(); }}
                style={{ flex: 2 }}
            />
        </View>
    ) : (
        <Button
            title={saveBlocked || (ed.dirty ? 'Save changes' : 'No changes yet')}
            icon={ed.dirty && !saveBlocked ? 'check' : undefined}
            onPress={ed.save}
            loading={ed.saving}
            disabled={!ed.dirty || !!saveBlocked}
        />
    );
    return (
        <Screen
            title={title}
            subtitle={setup ? `Step ${setup.i + 1} of ${SETUP_STEPS.length} · ${subtitle || ''}` : subtitle}
            footer={ed.ready ? footer : null}
            pinned={phone ? (
                <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border }}>
                    <PreviewTabs phone={phone} />
                </View>
            ) : null}
        >
            {!ed.ready ? (ed.error ? <ErrorBox message={ed.error} onRetry={() => { }} /> : <Loading />) : (
                <>
                    {ed.errors?.length ? (
                        <View style={{ backgroundColor: t.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
                            <Text style={{ color: t.danger, fontWeight: '800', marginBottom: 4 }}>Fix these before saving</Text>
                            {ed.errors.map((e) => <Text key={e} style={{ color: t.danger, fontSize: font.sm }}>• {e}</Text>)}
                        </View>
                    ) : null}
                    {children}
                </>
            )}
        </Screen>
    );
}
