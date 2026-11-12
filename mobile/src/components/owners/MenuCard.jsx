// One dish as a card on the owner's Menu page on a computer: the picture on top (with the veg mark, a bestseller star and a "Sold out" veil), then the name, the price
// and the in-stock switch. Never used in the phone app (the phone keeps its list rows).
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { money } from './ui';
import { Toggle, VegMark } from './menuBits';
import { itemState } from '../../utils/owners/menuRules';
import { clockTime } from '../../utils/owners/orderFlow';
import { tr } from '../../i18n';

export default function MenuCard({ item, selected, onOpen, onSwitch, onStep }) {
    const { text, muted, surface, border, primary, error, ok, accent } = useBrand();
    const state = itemState(item);
    const dim = state !== 'on';
    const kg = item.sellBy === 'weight' ? '/kg' : item.sellBy === 'volume' ? '/L' : '';
    const counted = !!item.stock?.enabled;
    const low = counted && state === 'on' && item.stock.qty <= (item.sellBy === 'piece' ? 5 : 2);
    const veil = state === 'timed' ? `${tr('Back at {clockTime}', { clockTime: clockTime(item.unavailableUntil) })}` : state === 'stock' ? tr('Stock finished') : tr('Sold out');
    return (
        <Pressable onPress={onOpen} style={({ hovered }) => ({ borderRadius: 22, borderWidth: selected ? 2 : 1, borderColor: selected || hovered ? primary : border, backgroundColor: surface, overflow: 'hidden', cursor: 'pointer', boxShadow: hovered && !selected ? `0 0 0 3px ${alpha(primary, 0.18)}` : '0 0 0 0 transparent', transitionProperty: 'box-shadow, border-color', transitionDuration: '150ms' })}>
            <View style={{ aspectRatio: 16 / 10, backgroundColor: alpha(muted, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                {item.image ? <Image source={{ uri: item.image }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: dim ? 0.55 : 1 }} contentFit="cover" /> : <Ionicons name="restaurant-outline" size={42} color={alpha(muted, 0.6)} />}
                <View style={{ position: 'absolute', left: 10, top: 10, width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' }}><VegMark isVeg={item.isVeg} size={13} /></View>
                {item.isBestseller ? (
                    <View style={{ position: 'absolute', right: 10, top: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, height: 26, borderRadius: 13, backgroundColor: accent || '#F59E0B' }}>
                        <Ionicons name="star" size={12} color="#FFFFFF" /><Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 11.5, marginLeft: 4 }}>{tr('Bestseller')}</Text>
                    </View>
                ) : null}
                {dim ? (
                    <View style={{ position: 'absolute', left: 10, bottom: 10, paddingHorizontal: 11, height: 26, borderRadius: 13, backgroundColor: error, justifyContent: 'center' }}>
                        <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 12 }}>{veil}</Text>
                    </View>
                ) : null}
            </View>
            <View style={{ padding: 14 }}>
                <Text numberOfLines={1} style={{ color: dim ? muted : text, fontWeight: '900', fontSize: 16 }}>{item.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
                    <Text style={{ color: dim ? muted : primary, fontWeight: '900', fontSize: 22, letterSpacing: -0.4 }}>{money(item.price)}</Text>
                    {kg ? <Text style={{ color: muted, fontWeight: '800', fontSize: 13, marginLeft: 2, marginBottom: 3 }}>{kg}</Text> : null}
                    <View style={{ flex: 1 }} />
                    {counted && item.sellBy === 'piece' && onStep ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12 }}>
                            <Pressable onPress={() => onStep(item, -1)} hitSlop={6} style={({ hovered }) => ({ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: hovered ? primary : border, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' })}><Ionicons name="remove" size={16} color={text} /></Pressable>
                            <Text style={{ color: low ? error : text, fontWeight: '900', minWidth: 30, textAlign: 'center' }}>{item.stock.qty}</Text>
                            <Pressable onPress={() => onStep(item, 1)} hitSlop={6} style={({ hovered }) => ({ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: hovered ? primary : border, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' })}><Ionicons name="add" size={16} color={text} /></Pressable>
                        </View>
                    ) : null}
                    <View onStartShouldSetResponder={() => true} onClick={(e) => e.stopPropagation()}><Toggle value={state === 'on'} onValueChange={(on) => onSwitch(item, on)} /></View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dim ? error : low ? '#F59E0B' : ok, marginRight: 6 }} />
                    <Text style={{ color: muted, fontSize: 12.5, fontWeight: '700' }}>{dim ? veil : low ? tr('{v1} left', { v1: item.stock.qty }) : counted ? tr('{v1} left', { v1: item.stock.qty }) : tr('In stock')}</Text>
                </View>
            </View>
        </Pressable>
    );
}
