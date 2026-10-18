// src/components/customers/storeLocation.jsx
//
// Where the shop is, for a customer who wants to visit it:
//   - the shop is pinned on the map  -> its address AND a "Directions" button that opens Google Maps
//   - only an address was entered    -> the address alone, no button
//   - nothing entered                -> nothing at all
// The superadmin can switch it off per shop (Features → "Directions to the shop").
import React from 'react';
import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, CardGlow } from '../common/kit';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { showToast } from './shop';
import { tr } from '../../i18n';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const addressText = (a) => (typeof a === 'string' ? a.trim() : [a?.line, a?.city, a?.pincode].filter(Boolean).join(', '));

// the shop's address and map pin, and whether the customer should be shown them at all
export function useStoreSpot() {
    const full = useHomeStore((st) => st.full);
    const delivery = useHomeStore((st) => st.delivery);
    const r = full.restaurant || {};
    const lat = num(r.latitude) ?? num(delivery?.latitude);
    const lng = num(r.longitude) ?? num(delivery?.longitude);
    return {
        on: full.features?.directions !== false,
        name: r.name || '',
        address: addressText(r.address),
        lat,
        lng,
        pinned: lat !== null && lng !== null,
    };
}

export function openDirections(spot) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=driving`;
    Linking.openURL(url).catch(() => showToast(tr('Could not open Google Maps')));
}

// How it is drawn is the shop's choice (Brand and look → Shop location):
//   card    a box with an icon, the address and a Directions button (the default)
//   list    a slim row between two thin lines, like a line in a list
//   chip    one small pill: the address and a Directions link, nothing else
//   banner  an edge-to-edge strip in the shop's colour
// inline: just the row (no card around it), for placing inside another card
export function StoreLocation({ inline = false, style }) {
    const { primary, onPrimary, text, muted, surface, border, radius } = useBrand();
    const variant = useThemeStore((st) => st.theme.locationStyle) || 'card';
    const spot = useStoreSpot();
    if (!spot.on || (!spot.address && !spot.pinned)) return null;

    if (!inline && variant === 'chip') {
        return (
            <View style={[s.chipWrap, style]}>
                <Pressable
                    onPress={spot.pinned ? () => openDirections(spot) : undefined}
                    style={[s.chip, { backgroundColor: surface, borderColor: border }]}
                    accessibilityRole={spot.pinned ? 'button' : 'text'}
                >
                    <Ionicons name="location-sharp" size={14} color={primary} />
                    <Text numberOfLines={1} style={[s.chipAddr, { color: text }]}>{spot.address || tr('On the map')}</Text>
                    {spot.pinned ? (
                        <>
                            <View style={[s.chipDot, { backgroundColor: muted }]} />
                            <Ionicons name="navigate" size={14} color={primary} />
                        </>
                    ) : null}
                </Pressable>
            </View>
        );
    }
    if (!inline && variant === 'list') {
        return (
            <Pressable
                onPress={spot.pinned ? () => openDirections(spot) : undefined}
                style={[s.list, { borderColor: border }, style]}
                accessibilityRole={spot.pinned ? 'button' : 'text'}
            >
                <Ionicons name={spot.pinned ? 'storefront-outline' : 'location-outline'} size={20} color={primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text numberOfLines={2} style={[s.addr, { color: text, marginTop: 0 }]}>{spot.address || tr('On the map')}</Text>
                    {spot.pinned ? <Text style={[s.listSub, { color: primary }]}>{tr('Tap the arrow for directions')}</Text> : null}
                </View>
                {spot.pinned ? <View style={[s.badge, { backgroundColor: primary }]}><Ionicons name="navigate" size={18} color={onPrimary} /></View> : null}
            </Pressable>
        );
    }
    if (!inline && variant === 'banner') {
        return (
            <View style={[s.banner, { backgroundColor: `${primary}1A`, borderColor: `${primary}33` }, style]}>
                <Ionicons name="location-sharp" size={18} color={primary} />
                <Text numberOfLines={2} style={[s.bannerAddr, { color: text }]}>{spot.address || tr('On the map')}</Text>
                {spot.pinned ? (
                    <Pressable onPress={() => openDirections(spot)} style={[s.badge, { backgroundColor: primary }]} accessibilityRole="button" accessibilityLabel={tr('Get directions')}>
                        <Ionicons name="navigate" size={18} color={onPrimary} />
                    </Pressable>
                ) : null}
            </View>
        );
    }

    const row = (
        <View style={s.row}>
            <View style={[s.ic, { backgroundColor: `${primary}1F` }]}>
                <Ionicons name={spot.pinned ? 'storefront-outline' : 'location-outline'} size={19} color={primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.cap, { color: muted }]}>{spot.pinned ? tr('VISIT US') : tr('FIND US')}</Text>
                <Text style={[s.addr, { color: text }]} numberOfLines={2}>{spot.address || tr('On the map')}</Text>
            </View>
            {spot.pinned ? (
                <Pressable onPress={() => openDirections(spot)} style={[s.badge, { backgroundColor: primary }]} accessibilityRole="button" accessibilityLabel={tr('Get directions')}>
                    <Ionicons name="navigate" size={18} color={onPrimary} />
                </Pressable>
            ) : null}
        </View>
    );
    if (inline) return row;
    return (
        <View style={[s.card, { backgroundColor: surface, borderColor: border }, style]}>
            <CardGlow radius={16} />
            {row}
        </View>
    );
}

const s = StyleSheet.create({
    card: { marginHorizontal: 16, marginTop: 14, padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    row: { flexDirection: 'row', alignItems: 'center' },
    ic: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    cap: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    addr: { fontSize: 13, fontWeight: '700', marginTop: 2, lineHeight: 18 },
    btn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, marginLeft: 8 },
    chipWrap: { marginHorizontal: 16, marginTop: 12, flexDirection: 'row' },
    chip: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: StyleSheet.hairlineWidth },
    chipAddr: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', marginLeft: 6 },
    chipDot: { width: 3, height: 3, borderRadius: 2, marginHorizontal: 8 },
    chipGo: { fontSize: 12.5, fontWeight: '900', marginRight: 2 },
    list: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
    listSub: { fontSize: 12, fontWeight: '800', marginTop: 2 },
    banner: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
    bannerAddr: { flex: 1, fontSize: 13, fontWeight: '700', marginLeft: 8, lineHeight: 18 },
    badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
    btnTxt: { fontSize: 12, fontWeight: '900', marginLeft: 5 },
});
