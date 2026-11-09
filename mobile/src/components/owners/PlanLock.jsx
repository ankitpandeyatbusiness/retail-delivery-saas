// Shows owners what a higher plan would give, quietly: a small GROWTH / PRO tag, and a note that opens the Plan screen only when tapped.
// Nothing here pops up by itself, and an owner whose plan already has the feature sees none of it.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

// "Growth" / "Pro" tag (plan names are not translated)
export function PlanTag({ need }) {
    const { primary } = useBrand();
    return (
        <View style={{ backgroundColor: primary, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }}>{String(need || 'Pro').toUpperCase()}</Text>
        </View>
    );
}

// the plan an owner needs for a feature, or null when his plan has it (or he has no plan yet: nothing is locked)
export const useNeeds = (feature) => {
    const plan = useMenuFlags((s) => s.plan);
    return plan && plan.features?.[feature] === false ? (plan.needs?.[feature] || 'Pro') : null;
};

// a tap on a locked thing: say what it is and offer the Plan screen
export async function askUpgrade(nav, { title, message, need }, go) {
    const yes = await ask({
        title, icon: 'lock-closed', confirmText: tr('See plans'), cancelText: tr('Not now'),
        message: `${message ? `${message}\n\n` : ''}${tr('Available in {plan}. Upgrade your plan to use it.', { plan: need })}`,
    });
    if (yes) (go || ((r) => nav.navigate(r)))('OwnerPlan');
}

// a small card where a hidden option would be: the tag, one benefit line, "See plans"
export function UpgradeNote({ feature, text, style }) {
    const need = useNeeds(feature);
    const nav = useNavigation();
    const { primary, text: ink, muted } = useBrand();
    if (!need) return null;
    return (
        <Pressable onPress={() => nav.navigate('OwnerPlan')} style={[{ flexDirection: 'row', alignItems: 'center', padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.08) }, style]}>
            <Ionicons name="lock-closed" size={18} color={primary} />
            <View style={{ flex: 1, marginHorizontal: 10 }}>
                <Text style={{ color: ink, fontSize: 13, fontWeight: '700' }}>{text}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Available in {plan}', { plan: need })}</Text>
            </View>
            <PlanTag need={need} />
        </Pressable>
    );
}
