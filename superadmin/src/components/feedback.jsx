import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, ActivityIndicator, Animated, Easing, PanResponder, Dimensions, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import Icon from './Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, spacing, radius, font, tint } from '../theme';
import { Button } from './ui';
import { Field } from './inputs';

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

// the sheet itself rises from the bottom (the dim layer only fades, so no dark band slides across the screen)
function SlideUp({ children }) {
    const y = useRef(new Animated.Value(60)).current;
    const o = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.parallel([
            Animated.timing(y, { toValue: 0, duration: 220, useNativeDriver: true }),
            Animated.timing(o, { toValue: 1, duration: 180, useNativeDriver: true }),
        ]).start();
    }, [y, o]);
    return <Animated.View style={{ transform: [{ translateY: y }], opacity: o }}>{children}</Animated.View>;
}

/*
 * Bottom sheet. Use it for secondary actions and short forms instead of a new screen.
 * Drag it down to dismiss. The drag is transform + opacity only with the native driver, so it follows
 * the finger on the UI thread (60fps); release past 110px (or with a quick flick) closes it, else it springs back.
 * dismissible={false} (e.g. while a request is running) pins it.
 */
const SCREEN_H = Dimensions.get('window').height;
const SheetCtx = createContext(null);

// a scrolling area inside a Sheet: while it is scrolled down the sheet leaves the gesture to it; at its top a downward drag closes the sheet
export function SheetScroll({ onTouchStart, onScroll, scrollEventThrottle = 16, ...rest }) {
    const ctx = useContext(SheetCtx);
    return (
        <ScrollView
            {...rest}
            scrollEventThrottle={scrollEventThrottle}
            onTouchStart={(e) => { if (ctx) { ctx.inScroll = true; ctx.y = ctx.y || 0; } onTouchStart?.(e); }}
            onScroll={(e) => { if (ctx) ctx.y = e.nativeEvent.contentOffset.y; onScroll?.(e); }}
        />
    );
}
export function Sheet({ visible, onClose, title, children, dismissible = true }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const drag = useRef(new Animated.Value(0)).current;
    const ctx = useRef({ inScroll: false, y: 0 }).current;
    const live = useRef({ onClose, dismissible });
    live.current = { onClose, dismissible };

    useEffect(() => { if (visible) drag.setValue(0); }, [visible, drag]);

    const pan = useRef(PanResponder.create({
        // claim only a clearly vertical, downward drag (capture phase, so it also works when the finger starts on an input or button);
        // a SheetScroll that is scrolled down keeps its own gesture
        onMoveShouldSetPanResponderCapture: (_, g) => live.current.dismissible && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5 && !(ctx.inScroll && ctx.y > 1),
        // setValue pushes straight to the native node; Animated.event can't be native-driven from a PanResponder
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
            if (g.dy > 110 || g.vy > 0.9) {
                Animated.timing(drag, { toValue: SCREEN_H, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true })
                    .start(() => live.current.onClose());
            } else {
                Animated.spring(drag, { toValue: 0, bounciness: 0, speed: 18, useNativeDriver: true }).start();
            }
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, bounciness: 0, speed: 18, useNativeDriver: true }).start(),
    })).current;

    // upward drags are ignored (the sheet never lifts off its edge)
    const y = drag.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' });
    const dim = drag.interpolate({ inputRange: [0, 320], outputRange: [1, 0.15], extrapolate: 'clamp' });

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay, opacity: dim }]}>
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                </Animated.View>
                <SlideUp>
                    <Animated.View
                        {...pan.panHandlers}
                        onTouchStartCapture={() => { ctx.inScroll = false; }}
                        style={[s.sheet, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, spacing.lg), transform: [{ translateY: y }] }]}
                    >
                        <View style={s.grabHit}><View style={[s.grab, { backgroundColor: t.border }]} /></View>
                        {title ? <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '700', marginBottom: spacing.lg }}>{title}</Text> : null}
                        <SheetCtx.Provider value={ctx}>{children}</SheetCtx.Provider>
                    </Animated.View>
                </SlideUp>
            </KeyboardAvoidingView>
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
