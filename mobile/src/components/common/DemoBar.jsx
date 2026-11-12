// A small "Demo" pill shown ONLY to a person who signed in with the private demo login. It opens a sheet to jump between the
// Customer, Owner, Cook, Waiter and Rider panels. Everyone else never sees it (the app is unchanged for them).
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useBrand, alpha } from './kit';
import { Sheet } from '../owners/ui';
import { fetchDemoPanels, switchDemoPanel, resetDemo } from '../../utils/common/demoSwitch';
import { themedAlert, ask } from './dialog';
import { tr } from '../../i18n';
import { useTutorialStore } from '../../tutorial/store';

const ICON = { customer: 'bag-handle-outline', owner: 'storefront-outline', cook: 'restaurant-outline', waiter: 'cafe-outline', rider: 'bicycle-outline' };
const ROLE_PANEL = { customer: 'customer', admin: 'owner', kitchen: 'cook', waiter: 'waiter', rider: 'rider' };

export default function DemoBar() {
    const demo = useAuthStore((s) => !!s.user?.demo);
    const role = useAuthStore((s) => s.user?.role);
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, text, muted, border, surface } = useBrand();
    const [open, setOpen] = useState(false);
    const [panels, setPanels] = useState(null);
    const [busy, setBusy] = useState('');
    if (!demo) return null;

    const show = async () => {
        setOpen(true);
        try { setPanels((await fetchDemoPanels()).panels); } catch (e) { setPanels([]); }
    };
    const pick = async (p) => {
        if (busy || !p.available || ROLE_PANEL[role] === p.key) return;
        setBusy(p.key);
        try { await switchDemoPanel(p.key); } catch (e) {
            setBusy('');
            themedAlert(tr('Demo'), e.response?.data?.error || tr('Could not open that panel. Please try again.'));
        }
    };

    const reset = async () => {
        const yes = await ask({ title: tr('Reset the demo?'), message: tr('Everything you tried goes back to the start. You stay signed in.'), confirmText: tr('Reset'), cancelText: tr('Cancel') }).catch(() => false);
        if (!yes || busy) return;
        setBusy('reset');
        try { await resetDemo(); } catch (e) {
            setBusy('');
            themedAlert(tr('Demo'), e.response?.data?.error || tr('Could not reset the demo. Please try again.'));
        }
    };

    return (
        <>
            <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 4, right: 10, zIndex: 50 }}>
                <Pressable onPress={show} accessibilityLabel={tr('Demo panels')} style={({ pressed }) => [{
                    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14,
                    backgroundColor: primary, opacity: pressed ? 0.8 : 0.92,
                }]}>
                    <Ionicons name="sparkles" size={12} color={onPrimary} />
                    <Text style={{ color: onPrimary, fontSize: 12, fontWeight: '800' }}>{tr('Demo')}</Text>
                    <Ionicons name="chevron-down" size={12} color={onPrimary} />
                </Pressable>
            </View>
            <Sheet visible={open} onClose={() => { if (!busy) setOpen(false); }} title={tr('Try a panel')}>
                <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>
                    {tr('You are in a demo. Nothing is real: no real orders, money or messages. Pick who you want to be.')}
                </Text>
                <Pressable onPress={() => { setOpen(false); useTutorialStore.getState().openMenu(); }} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, marginBottom: 12, borderRadius: 16, backgroundColor: alpha(primary, 0.1), borderWidth: 1, borderColor: primary }, pressed && { opacity: 0.7 }]}>
                    <Ionicons name="book-outline" size={20} color={primary} />
                    <Text style={{ flex: 1, marginLeft: 12, color: text, fontSize: 15, fontWeight: '800' }}>{tr('Stories: show me around')}</Text>
                    <Ionicons name="chevron-forward" size={18} color={muted} />
                </Pressable>
                {!panels ? <ActivityIndicator color={primary} style={{ marginVertical: 20 }} /> : panels.map((p) => {
                    const on = ROLE_PANEL[role] === p.key;
                    return (
                        <Pressable key={p.key} onPress={() => pick(p)} disabled={!p.available} style={({ pressed }) => [{
                            flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8,
                            borderRadius: 16, borderWidth: on ? 1.5 : 1, borderColor: on ? primary : border,
                            backgroundColor: on ? alpha(primary, 0.08) : surface, opacity: p.available ? 1 : 0.45,
                        }, pressed && { opacity: 0.7 }]}>
                            <Ionicons name={ICON[p.key] || 'person-outline'} size={20} color={on ? primary : text} />
                            <Text style={{ flex: 1, marginLeft: 12, color: text, fontSize: 15, fontWeight: on ? '800' : '600' }}>{tr(p.label)}</Text>
                            {busy === p.key ? <ActivityIndicator color={primary} /> : on ? <Ionicons name="checkmark-circle" size={20} color={primary} /> : !p.available ? <Text style={{ color: muted, fontSize: 12 }}>{tr('Off')}</Text> : null}
                        </Pressable>
                    );
                })}
                <Pressable onPress={reset} disabled={!!busy} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: 4, borderRadius: 16, borderWidth: 1, borderColor: border }, pressed && { opacity: 0.7 }]}>
                    {busy === 'reset' ? <ActivityIndicator color={primary} /> : <Ionicons name="refresh" size={16} color={muted} />}
                    <Text style={{ color: muted, fontSize: 14, fontWeight: '700' }}>{tr('Reset the demo')}</Text>
                </Pressable>
            </Sheet>
        </>
    );
}
