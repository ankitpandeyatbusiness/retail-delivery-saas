// One round button at the bottom right instead of a pile of cards (cart, dine in table, reserved table, order on its way).
// It shows the icon of each of them. Touch and hold: they fan out above it with their names. Slide onto one and let go to open it.
// A quick tap opens the dine in table if there is one, else the cart, else the first.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, PanResponder, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { useDock, dockList } from '../../store/customers/useDock';
import { tr } from '../../i18n';

const TAB_H = 62;
const DISC = 60;
const ROW = 64;   // distance between the round shortcuts above the button

export default function BottomDock({ navRef }) {
    const items = useDock((s) => s.items);
    const list = dockList(items);
    const insets = useSafeAreaInsets();
    const { primary, onPrimary, surface, text, border } = useBrand();
    const [open, setOpen] = useState(false);
    const [hover, setHover] = useState(-1);
    const live = useRef({ list, open: false });
    live.current.list = list;
    const timer = useRef(null);
    const fade = useRef(new Animated.Value(0)).current;

    const go = (it) => { if (it && navRef?.isReady?.()) navRef.navigate(it.route, it.params); };
    const indexAt = (dx, dy) => {
        const n = live.current.list.length;
        const i = Math.round(-dy / ROW) - 1;
        return i >= 0 && i < n && dx > -240 && dx < 50 ? i : -1;
    };
    const close = () => { clearTimeout(timer.current); live.current.open = false; setOpen(false); setHover(-1); };

    const pan = useRef(PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => { timer.current = setTimeout(() => { live.current.open = true; setOpen(true); }, 180); },
        onPanResponderMove: (_, g) => { if (live.current.open) setHover(indexAt(g.dx, g.dy)); },
        onPanResponderRelease: (_, g) => {
            const l = live.current;
            if (l.open) { const i = indexAt(g.dx, g.dy); close(); if (i >= 0) go(l.list[i]); return; }
            close();
            go(l.list.find((x) => x.key === 'table') || l.list.find((x) => x.key === 'cart') || l.list[0]);   // a quick tap
        },
        onPanResponderTerminate: close,
    })).current;

    useEffect(() => { Animated.timing(fade, { toValue: open ? 1 : 0, duration: 160, useNativeDriver: true }).start(); }, [open, fade]);
    useEffect(() => { if (list.length < 2) close(); }, [list.length]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (list.length < 2) return null;

    const bottom = insets.bottom + TAB_H + 18;
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', opacity: fade }} />
            {open ? list.map((it, i) => (
                <Animated.View key={it.key} pointerEvents="none" style={{ position: 'absolute', right: 14, bottom: bottom + (i + 1) * ROW, flexDirection: 'row', alignItems: 'center', opacity: fade }}>
                    <View style={{ marginRight: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: hover === i ? primary : surface, borderWidth: 1, borderColor: hover === i ? primary : border, maxWidth: 220 }}>
                        <Text numberOfLines={1} style={{ color: hover === i ? onPrimary : text, fontWeight: '900', fontSize: 14 }}>{tr(it.label)}</Text>
                        {it.sub ? <Text numberOfLines={1} style={{ color: hover === i ? onPrimary : text, opacity: 0.75, fontSize: 11.5 }}>{it.sub}</Text> : null}
                    </View>
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: hover === i ? primary : surface, borderWidth: 1, borderColor: hover === i ? primary : border, alignItems: 'center', justifyContent: 'center', elevation: 6, transform: [{ scale: hover === i ? 1.12 : 1 }] }}>
                        <Ionicons name={it.icon} size={24} color={hover === i ? onPrimary : primary} />
                    </View>
                </Animated.View>
            )) : null}
            <View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={tr('Open one of your cards. Touch and hold, then slide to choose.')}
                style={{ position: 'absolute', right: 14, bottom, width: DISC, height: DISC, borderRadius: DISC / 2, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
                <View style={{ width: 40, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
                    {list.slice(0, 4).map((it) => <Ionicons key={it.key} name={it.icon} size={list.length > 2 ? 17 : 20} color={onPrimary} style={{ margin: 1.5 }} />)}
                </View>
            </View>
        </View>
    );
}
