// The plan line the owner reads on the Home screen and in the side menu: "Growth, ends 12 Dec (21 days left)"; "Partner, wallet Rs 420"; "Pro ended. Choose your plan".
// Tap = the Plan screen. The plan comes from the owner's settings (useMenuFlags); a Partner shop also shows its wallet balance. Nothing shows before a plan exists.
import React, { useEffect, useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { fetchWallet } from '../../api/owners/shopApi';
import { rupees } from '../../utils/owners/riderRules';
import { tr } from '../../i18n';

export const planLineOf = (p, walletPaise) => {
    const name = p.id[0].toUpperCase() + p.id.slice(1);
    if (p.status === 'ended') return tr('{name} ended. Choose your plan', { name });
    if (p.id === 'partner' && walletPaise !== null && walletPaise !== undefined) return tr('{name}, wallet {rupees}', { name, rupees: rupees(walletPaise) });
    return p.endsAt ? tr('{name}, ends {date} ({n} days left)', { name, date: new Date(p.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), n: p.daysLeft }) : name;
};

export default function PlanChip({ compact = false, onGo, style }) {
    const nav = useNavigation();
    const { primary, error, muted, text } = useBrand();
    const plan = useMenuFlags((s) => s.plan);
    const [wallet, setWallet] = useState(null);
    useEffect(() => { useMenuFlags.getState().refresh(); }, []);
    useEffect(() => {
        if (plan?.id !== 'partner') return undefined;
        let on = true;
        fetchWallet().then((w) => { if (on) setWallet(w.balancePaise); }).catch(() => { });
        return () => { on = false; };
    }, [plan?.id]);
    if (!plan?.id) return null;
    const bad = plan.status === 'ended';
    const color = bad ? error : primary;
    if (compact) {
        return (
            <Text style={{ color: bad ? error : muted, fontSize: 12, marginTop: 1, fontWeight: bad ? '800' : '600' }} numberOfLines={1}>{planLineOf(plan, wallet)}</Text>
        );
    }
    return (
        <Pressable
            onPress={() => { if (onGo) onGo(); nav.navigate('OwnerPlan'); }}
            accessibilityRole="button"
            style={[{ marginHorizontal: 16, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: alpha(color, 0.1), flexDirection: 'row', alignItems: 'center' }, style]}
        >
            <Ionicons name={bad ? 'alert-circle' : 'ribbon'} size={18} color={color} />
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: bad ? error : text, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>{planLineOf(plan, wallet)}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={muted} />
        </Pressable>
    );
}
