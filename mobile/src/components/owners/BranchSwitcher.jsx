// At the top of the owner's side menu, for a BRAND owner only: the branch on screen, the other branches to switch to, and "All branches".
// For every other owner this draws nothing.
import React, { useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../common/kit';
import { ask } from '../common/dialog';
import { showToast } from '../customers/shop';
import { useBrandStore } from '../../store/owners/useBrandStore';
import { switchBranch } from '../../utils/common/switchBranch';
import { tr } from '../../i18n';
import { SideRow, SideGroupTitle } from '../common/SidebarExtras';

// slim: the owner's desktop sidebar (slim rows with an icon tile, the branch on screen lit up); the phone's drawer keeps the bordered card
export default function BranchSwitcher({ onGo, slim, routeName }) {
    const nav = useNavigation();
    const { text, muted, border, surface, primary } = useBrand();
    const me = useBrandStore((s) => s.me);
    useEffect(() => { useBrandStore.getState().load(); }, []);
    if (!me || !me.branches || me.branches.length < 2) return null;

    const go = async (b) => {
        if (b.slug === me.current) return;
        const yes = await ask({
            title: tr('Switch to {name}?', { name: b.name }),
            message: me.canManage === false && me.viewOnly !== undefined ? tr('The app restarts and opens {name}. You can look at it but not change anything, because managing branches needs the Pro plan.', { name: b.name }) : tr('The app restarts and opens {name}.', { name: b.name }),
            confirmText: tr('Switch'),
        });
        if (!yes) return;
        try { await switchBranch(b.slug); } catch (e) { showToast(tr('Could not switch. Please try again.')); }
    };

    if (slim) {
        const links = [
            ['OwnerAllBranches', 'git-network-outline', tr('All branches')],
            ['OwnerPushMenu', 'send-outline', tr('Send dishes to branches')],
            ['OwnerBranchInbox', 'notifications-outline', tr('Notifications of all branches')],
            ['OwnerBranchAlerts', 'options-outline', tr('Alerts by branch')],
        ];
        return (
            <View style={{ paddingHorizontal: 12, marginTop: 8, marginBottom: 4 }}>
                <SideGroupTitle>{me.brand.name}</SideGroupTitle>
                {me.branches.map((b) => <SideRow key={b.slug} icon="storefront-outline" title={b.name} note={b.city || undefined} active={b.slug === me.current} onPress={() => go(b)} />)}
                <View style={{ height: 8 }} />
                {links.map(([route, icon, title]) => <SideRow key={route} icon={icon} title={title} active={routeName === route} onPress={() => { if (onGo) onGo(); nav.navigate(route); }} />)}
            </View>
        );
    }

    return (
        <View style={{ marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
            <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginBottom: 6 }}>{me.brand.name}</Text>
            {me.branches.map((b) => {
                const on = b.slug === me.current;
                return (
                    <Pressable key={b.slug} onPress={() => go(b)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9 }}>
                        <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? primary : muted} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={{ color: text, fontWeight: on ? '900' : '700', fontSize: 15 }} numberOfLines={1}>{b.name}</Text>
                            {b.city ? <Text style={{ color: muted, fontSize: 12 }}>{b.city}</Text> : null}
                        </View>
                    </Pressable>
                );
            })}
            <Pressable
                onPress={() => { if (onGo) onGo(); nav.navigate('OwnerAllBranches'); }}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10, marginTop: 4, borderTopWidth: 1, borderTopColor: border }}
            >
                <Ionicons name="git-network-outline" size={20} color={primary} />
                <Text style={{ color: primary, fontWeight: '900', marginLeft: 10, flex: 1 }}>{tr('All branches')}</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
            <Pressable
                onPress={() => { if (onGo) onGo(); nav.navigate('OwnerPushMenu'); }}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10 }}
            >
                <Ionicons name="send-outline" size={20} color={primary} />
                <Text style={{ color: primary, fontWeight: '900', marginLeft: 10, flex: 1 }}>{tr('Send dishes to branches')}</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
            <Pressable
                onPress={() => { if (onGo) onGo(); nav.navigate('OwnerBranchInbox'); }}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10 }}
            >
                <Ionicons name="notifications-outline" size={20} color={primary} />
                <Text style={{ color: primary, fontWeight: '900', marginLeft: 10, flex: 1 }}>{tr('Notifications of all branches')}</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
            <Pressable
                onPress={() => { if (onGo) onGo(); nav.navigate('OwnerBranchAlerts'); }}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10 }}
            >
                <Ionicons name="options-outline" size={20} color={primary} />
                <Text style={{ color: primary, fontWeight: '900', marginLeft: 10, flex: 1 }}>{tr('Alerts by branch')}</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
        </View>
    );
}
