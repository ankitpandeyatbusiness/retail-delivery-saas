// The tutorial on screen, for the demo only (private demo login and public demo website): the story menu, the step card at the
// bottom, and a ring round the button a step points at. Nothing shows for anyone who is not in a demo.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Switch, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/common/useAuthStore';
import { useBrand, alpha } from '../components/common/kit';
import { Sheet } from '../components/owners/ui';
import { switchDemoPanel } from '../utils/common/demoSwitch';
import { themedAlert } from '../components/common/dialog';
import { tr } from '../i18n';
import { useTutorialStore } from './store';
import { STORIES, storyById } from './stories';
import { getRect, onRect } from './CoachTarget';

export const ROLE_PANEL = { customer: 'customer', admin: 'owner', kitchen: 'cook', waiter: 'waiter', rider: 'rider' };
const PANEL_NAME = { customer: 'Customer', owner: 'Owner', cook: 'Cook', waiter: 'Waiter', rider: 'Rider' };

function Ring({ id }) {
    const { primary } = useBrand();
    const [, force] = useState(0);
    useEffect(() => onRect((who) => { if (who === id) force((n) => n + 1); }), [id]);
    const r = getRect(id);
    if (!r) return null;
    return <View pointerEvents="none" style={{ position: 'absolute', left: r.x - 6, top: r.y - 6, width: r.w + 12, height: r.h + 12, borderRadius: 16, borderWidth: 3, borderColor: primary, backgroundColor: alpha(primary, 0.12) }} />;
}

export function StoryMenu() {
    const { text, muted, border, primary, surface } = useBrand();
    const open = useTutorialStore((s) => s.menuOpen);
    const enabled = useTutorialStore((s) => s.enabled);
    const done = useTutorialStore((s) => s.done);
    const close = useTutorialStore((s) => s.closeMenu);
    const start = useTutorialStore((s) => s.start);
    const setEnabled = useTutorialStore((s) => s.setEnabled);
    return (
        <Sheet visible={open} onClose={close} title={tr('Stories')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: text, fontSize: 15, fontWeight: '800' }}>{tr('Show me around')}</Text>
                    <Text style={{ color: muted, fontSize: 12.5 }}>{tr('Short stories with a guide. Switch off to explore freely.')}</Text>
                </View>
                <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: primary }} />
            </View>
            {STORIES.map((s) => (
                <Pressable key={s.id} onPress={() => start(s.id)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', padding: 13, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface }, pressed && { opacity: 0.7 }]}>
                    <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: alpha(primary, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={s.icon} size={19} color={primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontSize: 15, fontWeight: '800' }}>{tr(s.title)}</Text>
                        <Text style={{ color: muted, fontSize: 12.5 }}>{tr(s.who)} · {tr('{n} min', { n: s.min })}</Text>
                    </View>
                    {done.includes(s.id) ? <Ionicons name="checkmark-circle" size={20} color={primary} /> : <Ionicons name="chevron-forward" size={18} color={muted} />}
                </Pressable>
            ))}
        </Sheet>
    );
}

function StepCard() {
    const insets = useSafeAreaInsets();
    const { text, muted, border, primary, onPrimary, surface } = useBrand();
    const role = useAuthStore((s) => s.user?.role);
    const activeId = useTutorialStore((s) => s.activeId);
    const step = useTutorialStore((s) => s.step);
    const { next, back, quit } = useTutorialStore.getState();
    const [busy, setBusy] = useState(false);
    const story = activeId ? storyById(activeId) : null;
    if (!story) return null;
    const st = story.steps[step];
    const here = ROLE_PANEL[role];
    const wrongPanel = story.panel && here !== story.panel;
    const last = step === story.steps.length - 1;
    const become = async () => {
        setBusy(true);
        try { await switchDemoPanel(story.panel); } catch (e) { setBusy(false); themedAlert(tr('Demo'), e.response?.data?.error || tr('Could not open that panel. Please try again.')); }
    };
    return (
        <>
            {!wrongPanel && st.target ? <Ring id={st.target} /> : null}
            <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 78, alignItems: 'center', zIndex: 60 }}>
                <View style={{ width: '100%', maxWidth: 520, padding: 14, borderRadius: 20, backgroundColor: surface, borderWidth: 1, borderColor: border, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ flex: 1, color: primary, fontSize: 12, fontWeight: '800' }}>{tr(story.title)} · {step + 1}/{story.steps.length}</Text>
                        <Pressable onPress={quit} hitSlop={10} accessibilityLabel={tr('Close')}><Ionicons name="close" size={20} color={muted} /></Pressable>
                    </View>
                    {wrongPanel ? (
                        <>
                            <Text style={{ color: text, fontSize: 15, lineHeight: 21 }}>{tr('This story is about the {panel}. Tap to become them.', { panel: tr(PANEL_NAME[story.panel]) })}</Text>
                            <Pressable onPress={become} disabled={busy} style={{ marginTop: 12, paddingVertical: 12, borderRadius: 14, backgroundColor: primary, alignItems: 'center' }}>
                                {busy ? <ActivityIndicator color={onPrimary} /> : <Text style={{ color: onPrimary, fontWeight: '800' }}>{tr('Become the {panel}', { panel: tr(PANEL_NAME[story.panel]) })}</Text>}
                            </Pressable>
                        </>
                    ) : (
                        <>
                            <Text style={{ color: text, fontSize: 15, lineHeight: 21 }}>{tr(st.text)}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 12, gap: 10 }}>
                                {step > 0 ? <Pressable onPress={back} style={{ paddingVertical: 11, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: border }}><Text style={{ color: muted, fontWeight: '700' }}>{tr('Back')}</Text></Pressable> : null}
                                <Pressable onPress={next} style={{ flex: 1, paddingVertical: 11, borderRadius: 14, backgroundColor: primary, alignItems: 'center' }}>
                                    <Text style={{ color: onPrimary, fontWeight: '800' }}>{last ? tr('Done') : st.target ? tr('Skip this step') : tr('Next')}</Text>
                                </Pressable>
                            </View>
                        </>
                    )}
                </View>
            </View>
        </>
    );
}

export default function TutorialHost() {
    const demo = useAuthStore((s) => !!s.user?.demo);
    const loaded = useTutorialStore((s) => s.loaded);
    const offered = useTutorialStore((s) => s.offered);
    const enabled = useTutorialStore((s) => s.enabled);
    const activeId = useTutorialStore((s) => s.activeId);
    useEffect(() => { if (demo) useTutorialStore.getState().hydrate(); }, [demo]);
    // the first time in the demo, the story menu opens by itself (once)
    useEffect(() => {
        if (!demo || !loaded || offered || !enabled || activeId) return undefined;
        const t = setTimeout(() => useTutorialStore.getState().openMenu(), 1500);
        return () => clearTimeout(t);
    }, [demo, loaded, offered, enabled, activeId]);
    if (!demo) return null;
    return (
        <>
            <StoryMenu />
            {enabled ? <StepCard /> : null}
        </>
    );
}
