// The cook's and the waiter's panel on a computer (a browser at least 1024 px wide): a left sidebar instead of the floating bottom tabs.
// The job's work page on top (Kitchen or Waiter, with the number of things waiting), then My work and Profile. A button folds it to icons.
// Never drawn in the phone app or on a narrow window: DesktopFrame only mounts it when useStaffDesktop() is true.
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../common/kit';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { useKitchenStore } from '../../store/staff/useKitchenStore';
import { useWaiterStore } from '../../store/staff/useWaiterStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { ShopLogo } from '../owners/ui';
import { JobBadge } from './staffBits';
import { tr } from '../../i18n';

const WIDE = 260;
const NARROW = 72;
const KEY = 'staff.sidebar.folded';
const read = () => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const save = (v) => { try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) { /* not saved */ } };

export default function StaffSidebar({ routeName }) {
    const nav = useNavigation();
    const { surface, background, border, text, muted, primary, onPrimary, error } = useBrand();
    const [folded, setFolded] = useState(read);
    const role = useStaffStore((s) => s.me?.role) || useAuthStore.getState().user?.role;
    const shop = useStaffStore((s) => s.me?.shop) || useThemeStore((s) => s.theme.name);
    const me = useStaffStore((s) => s.me);
    const waiting = useKitchenStore((s) => s.counts.new);
    const todo = useWaiterStore((s) => s.counts.serve + s.counts.requests);
    const badge = role === 'kitchen' ? waiting : todo;
    const cook = role === 'kitchen';
    const items = [
        ['StaffHomeTab', cook ? 'Kitchen' : 'Waiter', cook ? 'flame-outline' : 'restaurant-outline', cook ? 'flame' : 'restaurant', badge],
        ['StaffWorkTab', 'My work', 'stats-chart-outline', 'stats-chart', 0],
        ['StaffProfileTab', 'Profile', 'person-outline', 'person', 0],
    ];
    const toggle = () => setFolded((f) => { save(!f); return !f; });

    return (
        <View style={{ width: folded ? NARROW : WIDE, backgroundColor: surface || background, borderRightWidth: 1, borderRightColor: border, height: '100%', transitionProperty: 'width', transitionDuration: '180ms' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 18, paddingHorizontal: folded ? 0 : 16, justifyContent: folded ? 'center' : 'flex-start' }}>
                <ShopLogo size={folded ? 42 : 46} />
                {folded ? null : (
                    <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                        <Text style={{ color: text, fontSize: 16.5, fontWeight: '900' }} numberOfLines={1}>{shop || tr('My shop')}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 1, marginBottom: 4 }} numberOfLines={1}>{me?.name || me?.phone || ''}</Text>
                        {role ? <JobBadge role={role} /> : null}
                    </View>
                )}
            </View>
            <View style={{ paddingHorizontal: folded ? 10 : 12, flex: 1 }}>
                {items.map(([name, label, icon, on, n]) => {
                    const here = routeName === name;
                    return (
                        <Pressable key={name} onPress={() => nav.navigate('MainTabs', { screen: name })} accessibilityRole="button" accessibilityLabel={tr(label)}
                            style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: folded ? 'center' : 'flex-start', height: 48, borderRadius: 14, paddingHorizontal: folded ? 0 : 14, marginBottom: 4, cursor: 'pointer', backgroundColor: here ? primary : hovered ? border : 'transparent' })}>
                            <View>
                                <Ionicons name={here ? on : icon} size={22} color={here ? onPrimary : text} />
                                {folded && n > 0 ? <View style={{ position: 'absolute', top: -3, right: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: error }} /> : null}
                            </View>
                            {folded ? null : <Text style={{ flex: 1, marginLeft: 14, color: here ? onPrimary : text, fontSize: 15, fontWeight: '800' }}>{tr(label)}</Text>}
                            {!folded && n > 0 ? (
                                <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: here ? onPrimary : error, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ color: here ? primary : '#FFFFFF', fontSize: 12, fontWeight: '900' }}>{n}</Text>
                                </View>
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>
            <Pressable onPress={toggle} accessibilityLabel={folded ? tr('Open the sidebar') : tr('Fold the sidebar')}
                style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: folded ? 'center' : 'flex-start', height: 50, paddingHorizontal: folded ? 0 : 22, borderTopWidth: 1, borderTopColor: border, cursor: 'pointer', backgroundColor: hovered ? border : 'transparent' })}>
                <Ionicons name={folded ? 'chevron-forward' : 'chevron-back'} size={20} color={muted} />
                {folded ? null : <Text style={{ color: muted, fontSize: 13, fontWeight: '800', marginLeft: 10 }}>{tr('Fold sidebar')}</Text>}
            </Pressable>
        </View>
    );
}
