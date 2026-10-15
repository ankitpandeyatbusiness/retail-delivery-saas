import React from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, radius, font, tint } from '../theme';
import { Screen } from './layout';
import { Card, Button, Badge, SectionTitle } from './ui';
import { Loading, ErrorBox } from './feedback';
import Icon from './Icon';
import { previewFrom } from '../utils/settings';
import PhonePreview from './preview/PhonePreview';

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
    const phone = preview && ed.ready ? previewFrom(ed.preview || ed.rec?.resolved, ed.draft) : null;
    const footer = (
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
            subtitle={subtitle}
            footer={ed.ready ? footer : null}
            pinned={phone ? (
                <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: t.surface, borderBottomWidth: 1, borderBottomColor: t.border }}>
                    <PhonePreview config={phone} scale={0.46} collapsible />
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
