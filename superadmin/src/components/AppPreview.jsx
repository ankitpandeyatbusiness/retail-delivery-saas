import React from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import Icon from './Icon';
import { nameOf } from '../utils/settings';

const TAB_ICON = { home: 'home', search: 'search', offers: 'coupon', orders: 'orders', profile: 'user' };
const BLOCK_ICON = {
    search: 'search', banner: 'banner', categories: 'menu', filters: 'tune', offers: 'coupon', bestsellers: 'star',
    festival: 'sparkle', combos: 'box', new_arrivals: 'bolt', items: 'food',
};

/*
 * A small phone that shows how the customer app will look: the header colour, the home blocks
 * in order, the card style and the bottom tabs. It follows every choice made in the wizard.
 */
export default function AppPreview({ name, primary, tabs, blocks, cardStyle, shape }) {
    const t = useTheme();
    const radius = shape === 'pill' ? 20 : shape === 'square' ? 3 : 10;
    const on = blocks.filter((b) => b.enabled !== false);
    return (
        <View style={{ alignSelf: 'center', width: 250, borderRadius: 28, borderWidth: 6, borderColor: t.text, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
            <View style={{ backgroundColor: primary, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 14 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{name}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>Open now</Text>
            </View>
            <View style={{ padding: 10, minHeight: 250 }}>
                {on.map((b) => {
                    if (b.type === 'items') {
                        return (
                            <View key={b.type} style={{ flexDirection: cardStyle === 'grid' ? 'row' : 'column', gap: 6, marginTop: 6 }}>
                                {(cardStyle === 'grid' ? [0, 1] : [0, 1]).map((i) => (
                                    <View key={i} style={{ flex: cardStyle === 'grid' ? 1 : undefined, height: cardStyle === 'big' ? 54 : 34, borderRadius: 8, backgroundColor: '#F1F3F5', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
                                        <View style={{ width: cardStyle === 'big' ? 38 : 22, height: cardStyle === 'big' ? 38 : 22, borderRadius: 6, backgroundColor: `${primary}33` }} />
                                        <View style={{ marginLeft: 8, flex: 1 }}>
                                            <View style={{ height: 6, width: '70%', borderRadius: 3, backgroundColor: '#CED4DA' }} />
                                            <View style={{ height: 6, width: '35%', borderRadius: 3, backgroundColor: primary, marginTop: 5 }} />
                                        </View>
                                    </View>
                                ))}
                            </View>
                        );
                    }
                    return (
                        <View key={b.type} style={{ flexDirection: 'row', alignItems: 'center', height: 26, borderRadius: radius, backgroundColor: b.type === 'banner' ? `${primary}22` : '#F8F9FA', paddingHorizontal: 8, marginTop: 6 }}>
                            <Icon name={BLOCK_ICON[b.type] || 'info'} size={13} color={primary} />
                            <Text style={{ color: '#495057', fontSize: 10, fontWeight: '700', marginLeft: 6 }}>{nameOf('block', b.type)}</Text>
                        </View>
                    );
                })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#E9ECEF', backgroundColor: '#FFFFFF' }}>
                {tabs.map((tab, i) => (
                    <View key={tab} style={{ alignItems: 'center' }}>
                        <Icon name={TAB_ICON[tab] || 'info'} size={16} color={i === 0 ? primary : '#ADB5BD'} />
                        <Text style={{ fontSize: 8, fontWeight: '700', color: i === 0 ? primary : '#ADB5BD', marginTop: 2 }}>{nameOf('tab', tab)}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}
