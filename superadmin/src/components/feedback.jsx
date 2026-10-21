import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, FlatList, Pressable, Animated, Easing, PanResponder, Dimensions, Keyboard, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { ActivityIndicator } from './Loading';
import Icon from './Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, radius, font, tint } from '../theme';
import { Button } from './ui';
import { Field } from './inputs';
import Reanimated, { cancelAnimation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSheetPan } from './sheetPan';

export function Loading({ label }) {
    const t = useTheme();
    return (
        <View style={s.center}>
            <ActivityIndicator color={t.primary} />
            {label ? <Text style={{ color: t.muted, marginTop: spacing.md }}>{label}</Text> : null}
        </View>
    );
}

export function Empty({ icon = 'file-tray-outline', title, hint, action, onAction }) {
    const t = useTheme();
    return (
        <View style={s.center}>
            <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={44} color={t.primary} />
            </View>
            <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '700', marginTop: spacing.md, textAlign: 'center' }}>{title}</Text>
            {hint ? <Text style={{ color: t.muted, marginTop: 6, textAlign: 'center' }}>{hint}</Text> : null}
            {action ? <Button title={action} onPress={onAction} kind="soft" style={{ marginTop: spacing.lg }} /> : null}
        </View>
    );
}

export function ErrorBox({ message, onRetry }) {
    return <Empty icon="cloud-offline-outline" title="Could not load" hint={message} action="Try again" onAction={onRetry} />;
}

/*
 * Bottom sheet. Use it for secondary actions and short forms instead of a new screen.
 * It follows the same rules as the customer and shop-owner sheets: touch it ANYWHERE (handle, title, empty space, a form) and drag down
 * as far as you like; the position runs on the UI thread, so it tracks the finger at full frame rate. Past a third of its height (or a
 * quick flick) it slides away, else it springs back. A list inside it (SheetScroll) scrolls first and gives way only at its top.
 * dismissible={false} (e.g. while a request is running) pins it.
 */
const SHEET_OFF = 2000;   // "not on screen yet"
const SheetCtx = createContext(null);

// a scrolling area inside a Sheet: it scrolls as usual, and hands a downward swipe to the sheet once it is at its top
export function SheetScroll({ onScroll, ...rest }) {
    const sp = useContext(SheetCtx);
    return (
        <ScrollView
            {...rest}
            {...(sp || {})}
            onScroll={(e) => { sp?.onScroll?.(e); onScroll?.(e); }}
        />
    );
}
// a FlatList inside a Sheet (it cannot use SheetScroll): scrolls first, hands a downward swipe to the sheet at its top
export function SheetList({ onScroll, ...rest }) {
    const sp = useContext(SheetCtx);
    return <FlatList {...rest} {...(sp || {})} onScroll={(e) => { sp?.onScroll?.(e); onScroll?.(e); }} />;
}
export function Sheet({ visible, onClose, title, children, dismissible = true }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const [shown, setShown] = useState(visible);   // the Modal stays until the slide-out has finished
    const ty = useSharedValue(SHEET_OFF);
    const h = useSharedValue(400);
    const stillOpen = useRef(visible);
    stillOpen.current = visible;

    // Android: a transparent Modal ignores adjustResize, so lift the sheet by the keyboard height ourselves
    const [kb, setKb] = useState(0);
    useEffect(() => {
        if (Platform.OS !== 'android') return undefined;
        const a = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
        const b = Keyboard.addListener('keyboardDidHide', () => setKb(0));
        return () => { a.remove(); b.remove(); };
    }, []);

    // a pinned sheet (dismissible={false}) does not move: closing is refused, so the gesture is told it can never close
    const live = useRef({ onClose, dismissible });
    live.current = { onClose, dismissible };
    const close = useCallback(() => { if (live.current.dismissible) live.current.onClose(); }, []);
    const { gesture, scrollProps, scrollY } = useSheetPan({ ty, h, onClose: close, stillOpen });
    const drag = useMemo(() => (dismissible ? gesture : Gesture.Pan().enabled(false)), [dismissible, gesture]);

    useEffect(() => {
        if (visible) { cancelAnimation(ty); ty.value = SHEET_OFF; scrollY.value = 0; setShown(true); }
        else if (shown) {
            cancelAnimation(ty);
            ty.value = withTiming(Math.max(h.value, 300), { duration: 220 }, (done) => { if (done) runOnJS(setShown)(false); });
        }
    }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps

    const move = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
    const fade = useAnimatedStyle(() => ({ opacity: interpolate(ty.value, [0, Math.max(h.value, 1)], [1, 0], 'clamp') }));

    return (
        <Modal visible={shown} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: kb }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }, fade]} />
                    <Pressable style={StyleSheet.absoluteFill} onPress={close} />
                    <GestureDetector gesture={drag}>
                        <Reanimated.View
                            onLayout={(e) => { h.value = e.nativeEvent.layout.height; if (ty.value >= SHEET_OFF - 1 && visible) ty.value = withTiming(0, { duration: 260 }); }}
                            style={[s.sheet, { backgroundColor: t.surface, paddingBottom: kb ? spacing.lg : Math.max(insets.bottom, spacing.lg) }, move]}
                        >
                            <View style={s.grabHit}><View style={[s.grab, { backgroundColor: t.border }]} /></View>
                            {title ? <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '700', marginBottom: spacing.lg }}>{title}</Text> : null}
                            <SheetCtx.Provider value={scrollProps}>{children}</SheetCtx.Provider>
                        </Reanimated.View>
                    </GestureDetector>
                </KeyboardAvoidingView>
            </GestureHandlerRootView>
        </Modal>
    );
}

/*
 * Confirm a risky action. needReason asks for a short reason first.
 * onConfirm(reason) returns a promise: the button shows a spinner until it finishes, and the sheet
 * stays open if it throws (the caller shows the error).
 */
export function ConfirmSheet({ visible, onClose, title, message, confirmLabel = 'Confirm', danger, needReason, reasonLabel = 'Reason', onConfirm }) {
    const t = useTheme();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible) { setReason(''); setBusy(false); } }, [visible]);

    const go = async () => {
        setBusy(true);
        try { await onConfirm(reason.trim()); onClose(); } catch (e) { /* the caller shows the error */ } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={busy ? () => { } : onClose} title={title} dismissible={!busy}>
            {message ? <Text style={{ color: t.muted, fontSize: font.md, marginBottom: spacing.lg }}>{message}</Text> : null}
            {needReason ? <Field label={reasonLabel} value={reason} onChangeText={setReason} maxLength={200} /> : null}
            <Button title={confirmLabel} kind={danger ? 'danger' : 'primary'} onPress={go} loading={busy} disabled={needReason && !reason.trim()} />
            <Button title="Cancel" kind="outline" onPress={onClose} disabled={busy} style={{ marginTop: spacing.sm }} />
        </Sheet>
    );
}

/* ---- tiny toast: call toast('Saved') from anywhere; <ToastHost /> is rendered once in App ---- */
let show = null;
export const toast = (message, tone = 'ok') => { if (show) show(message, tone); };

export function ToastHost() {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const [msg, setMsg] = useState(null);
    const opacity = useRef(new Animated.Value(0)).current;
    const timer = useRef(null);

    useEffect(() => {
        show = (message, tone) => {
            setMsg({ message, tone });
            clearTimeout(timer.current);
            Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
            timer.current = setTimeout(() => {
                Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setMsg(null));
            }, 2400);
        };
        return () => { show = null; clearTimeout(timer.current); };
    }, [opacity]);

    if (!msg) return null;
    const bad = msg.tone === 'error';
    return (
        <Animated.View pointerEvents="none" style={[s.toast, { opacity, bottom: insets.bottom + 90, backgroundColor: bad ? t.danger : t.text }]}>
            <Text style={{ color: bad ? '#FFFFFF' : t.bg, fontWeight: '600' }}>{msg.message}</Text>
        </Animated.View>
    );
}

const s = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, minHeight: 240 },
    sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
    grabHit: { alignSelf: 'stretch', alignItems: 'center', paddingTop: spacing.xs, paddingBottom: spacing.lg },
    grab: { width: 40, height: 4, borderRadius: 2 },
    toast: { position: 'absolute', left: spacing.lg, right: spacing.lg, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
});
