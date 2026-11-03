// For a shop that is a BRANCH of a brand: a small line under the header, "Savera · Delhi", that opens "Choose your branch".
// The branches offered are the ones that deliver to the customer's spot (the chosen delivery address, else the phone's location).
// The first time the app opens, the chooser opens once by itself. A shop that is not a branch draws nothing.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrand } from '../common/kit';
import { Sheet } from '../owners/ui';
import { showToast } from './shop';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAddressStore } from '../../store/customers/useAddressStore';
import { fetchBranchesNear } from '../../api/customers/geoApi';
import { switchBranch } from '../../utils/common/switchBranch';
import { getSlug } from '../../utils/common/branch';
import { tr } from '../../i18n';

const ASKED_KEY = 'branchAsked';   // the chooser opened by itself once on this phone
const km = (n) => (n < 1 ? tr('under 1 km') : tr('{n} km', { n: Math.round(n * 10) / 10 }));

export default function BranchChip() {
    const { text, muted, border, surface, primary, onPrimary, error } = useBrand();
    const branch = useHomeStore((s) => s.branch);
    const addr = useAddressStore((s) => s.selected);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [list, setList] = useState(null);   // null = not asked yet
    const [note, setNote] = useState('');

    // the first time: open the chooser once
    useEffect(() => {
        if (!branch) return;
        AsyncStorage.getItem(ASKED_KEY).then((v) => {
            if (v) return;
            AsyncStorage.setItem(ASKED_KEY, '1').catch(() => { });
            setOpen(true);
        }).catch(() => { });
    }, [!!branch]);   // eslint-disable-line react-hooks/exhaustive-deps

    const find = useCallback(async (point) => {
        setBusy(true); setNote('');
        try {
            const r = await fetchBranchesNear(point);
            setList(r.branches || []);
            if (!(r.branches || []).length) setNote(tr('No branch delivers to this spot yet.'));
        } catch (e) { setNote(tr('Could not look for branches. Please try again.')); } finally { setBusy(false); }
    }, []);

    const useAddress = () => find({ lat: addr.latitude, lng: addr.longitude });
    const useMyLocation = async () => {
        setBusy(true); setNote('');
        try {
            const p = await Location.requestForegroundPermissionsAsync();
            if (p.status !== 'granted') { setNote(tr('Allow the location, or choose a delivery address.')); setBusy(false); return; }
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            await find({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        } catch (e) { setNote(tr('Could not get your location.')); setBusy(false); }
    };

    // the chooser shows the branches for the delivery address at once, when there is one
    useEffect(() => {
        if (open && list === null && addr && Number.isFinite(addr.latitude) && Number.isFinite(addr.longitude)) find({ lat: addr.latitude, lng: addr.longitude });
    }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!branch) return null;

    const go = async (b) => {
        if (b.slug === getSlug()) { setOpen(false); return; }
        setBusy(true);
        try { await switchBranch(b.slug); } catch (e) { setBusy(false); showToast(tr('Could not switch. Please try again.')); }
    };

    return (
        <>
            <Pressable
                onPress={() => setOpen(true)} accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, backgroundColor: surface, borderWidth: 1, borderColor: border }}
            >
                <Ionicons name="storefront-outline" size={17} color={primary} />
                <Text style={{ color: text, fontWeight: '800', marginLeft: 8, flex: 1 }} numberOfLines={1}>{[branch.brand, branch.city].filter(Boolean).join(' · ')}</Text>
                <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{tr('Change')}</Text>
                <Ionicons name="chevron-down" size={15} color={primary} style={{ marginLeft: 2 }} />
            </Pressable>

            <Sheet visible={open} onClose={() => setOpen(false)} title={tr('Choose your branch')}>
                <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{tr('We show the branches that deliver to your spot, nearest first.')}</Text>
                {addr && Number.isFinite(addr.latitude) ? (
                    <Pressable onPress={useAddress} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: border, marginBottom: 8 }}>
                        <Ionicons name="home-outline" size={18} color={primary} />
                        <Text style={{ color: text, fontWeight: '700', marginLeft: 10, flex: 1 }} numberOfLines={1}>{tr('For my address: {line}', { line: addr.line1 || addr.label || '' })}</Text>
                    </Pressable>
                ) : null}
                <Pressable onPress={useMyLocation} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: primary, marginBottom: 12 }}>
                    <Ionicons name="locate" size={18} color={onPrimary} />
                    <Text style={{ color: onPrimary, fontWeight: '900', marginLeft: 10 }}>{tr('Use my location')}</Text>
                </Pressable>
                {busy ? <ActivityIndicator color={primary} style={{ marginVertical: 12 }} /> : null}
                {note ? <Text style={{ color: error, fontWeight: '700', marginBottom: 8 }}>{note}</Text> : null}
                {(list || []).map((b) => {
                    const here = b.slug === getSlug();
                    return (
                        <Pressable key={b.slug} onPress={() => go(b)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: border }}>
                            <Ionicons name={here ? 'radio-button-on' : 'radio-button-off'} size={20} color={here ? primary : muted} />
                            <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{b.name}</Text>
                                <Text style={{ color: muted, fontSize: 12 }}>{[b.city, km(b.distanceKm)].filter(Boolean).join(' · ')}</Text>
                            </View>
                            {here ? <Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>{tr('You are here')}</Text> : null}
                        </Pressable>
                    );
                })}
            </Sheet>
        </>
    );
}
