import React from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, radius, font, tint } from '../theme';
import { Screen } from './layout';
import { Card, Button, Badge, SectionTitle } from './ui';
import { Loading, ErrorBox } from './feedback';
import Icon from './Icon';
import { nameOf } from '../utils/settings';

const TAB_ICON = { home: 'home', search: 'search', offers: 'coupon', orders: 'receipt', profile: 'user' };
const BLOCK_ICON = {
    search: 'search', banner: 'banner', categories: 'menu', filters: 'tune', offers: 'coupon',
    bestsellers: 'star', festival: 'sparkle', combos: 'box', new_arrivals: 'bolt', items: 'food',
};
const SHAPE = { rounded: 12, pill: 99, square: 3 };

/*
 * A small picture of the customer app, drawn from the config the SERVER would send for the current draft.
 * It is not a screenshot: it shows the things the settings change (colours, tabs, home blocks, filters, buttons).
 */
export function AppPreview({ config }) {
    const t = useTheme();
    if (!config) return null;
    const c = config.brand?.colors || {};
    const primary = c.primary || '#E23744';
    const bg = c.background || '#FFFFFF';
    const text = c.text || '#1C1C1C';
    const r = SHAPE[config.brand?.buttonShape] ?? 12;
    const home = config.home || {};

    return (
        <>
            <SectionTitle section="shops" right={<Badge label="Live preview" tone="primary" />}>What customers see</SectionTitle>
            <Card style={{ alignItems: 'center' }}>
                <View style={{ width: 250, borderRadius: 30, borderWidth: 6, borderColor: t.text, overflow: 'hidden', backgroundColor: bg }}>
                    {/* top bar */}
                    <View style={{ backgroundColor: primary, paddingHorizontal: 14, paddingVertical: 12 }}>
                        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{config.restaurant?.name || 'Your shop'}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>
                            {config.restaurant?.isOpen ? 'Open now' : 'Closed'} · {nameOf('foodMode', home.foodMode)}
                        </Text>
                    </View>
                    {/* home blocks in order */}
                    <View style={{ padding: 10, minHeight: 190 }}>
                        {(home.blocks || []).map((b) => (
                            <View key={b} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: tint(primary, 0.1), borderRadius: 10, paddingHorizontal: 8, height: b === 'banner' ? 44 : 30, marginBottom: 6 }}>
                                <Icon name={BLOCK_ICON[b] || 'info'} size={15} color={primary} />
                                <Text style={{ color: text, fontSize: 11, fontWeight: '700', marginLeft: 6 }}>{nameOf('block', b)}</Text>
                                {b === 'filters' && home.filters?.length ? (
                                    <Text style={{ color: text, opacity: 0.6, fontSize: 10, marginLeft: 6 }} numberOfLines={1}>{home.filters.length} filters</Text>
                                ) : null}
                            </View>
                        ))}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {config.features?.vegDot ? (
                                    <View style={{ flexDirection: 'row', marginRight: 8 }}>
                                        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#16A34A', marginRight: 3 }} />
                                        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#DC2626' }} />
                                    </View>
                                ) : null}
                                {config.features?.vegToggle ? <Text style={{ color: text, fontSize: 10, fontWeight: '700' }}>Veg only ⏽</Text> : null}
                            </View>
                            <View style={{ backgroundColor: primary, borderRadius: r, paddingHorizontal: 14, paddingVertical: 6 }}>
                                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{config.labels?.addButton || 'Add'}</Text>
                            </View>
                        </View>
                    </View>
                    {/* tab bar */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: tint(text, 0.1), paddingVertical: 8 }}>
                        {(config.tabs || []).map((tab, i) => (
                            <View key={tab} style={{ alignItems: 'center' }}>
                                <Icon name={TAB_ICON[tab] || 'info'} size={18} color={i === 0 ? primary : tint(text, 0.5)} filled={i === 0} />
                                <Text style={{ fontSize: 9, fontWeight: '700', color: i === 0 ? primary : tint(text, 0.5) }}>{nameOf('tab', tab)}</Text>
                            </View>
                        ))}
                    </View>
                </View>
                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md, textAlign: 'center' }}>
                    Font: {nameOf('font', config.brand?.fontStyle)} · Buttons: {nameOf('shape', config.brand?.buttonShape)} · {nameOf('cardStyle', home.cardStyle)}
                </Text>
            </Card>
        </>
    );
}

/*
 * The frame of every settings screen: header, loading and error states, the validation messages from the server,
 * the optional live preview, and the Save bar.
 */
export function SettingsPage({ ed, title, subtitle, children, preview = false }) {
    const t = useTheme();
    const footer = (
        <Button
            title={ed.dirty ? 'Save changes' : 'No changes yet'}
            icon={ed.dirty ? 'check' : undefined}
            onPress={ed.save}
            loading={ed.saving}
            disabled={!ed.dirty}
        />
    );
    return (
        <Screen title={title} subtitle={subtitle} footer={ed.ready ? footer : null}>
            {!ed.ready ? (ed.error ? <ErrorBox message={ed.error} onRetry={() => { }} /> : <Loading />) : (
                <>
                    {ed.errors?.length ? (
                        <View style={{ backgroundColor: t.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
                            <Text style={{ color: t.danger, fontWeight: '800', marginBottom: 4 }}>Fix these before saving</Text>
                            {ed.errors.map((e) => <Text key={e} style={{ color: t.danger, fontSize: font.sm }}>• {e}</Text>)}
                        </View>
                    ) : null}
                    {children}
                    {preview ? <AppPreview config={ed.preview} /> : null}
                </>
            )}
        </Screen>
    );
}
