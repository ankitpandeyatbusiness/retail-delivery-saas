import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ActivityIndicator, Animated, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
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

/* Bottom sheet. Use it for secondary actions and short forms instead of a new screen. */
export function Sheet({ visible, onClose, title, children }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }]} onPress={onClose} />
                <View style={[s.sheet, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
                    <View style={[s.grab, { backgroundColor: t.border }]} />
                    {title ? <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '700', marginBottom: spacing.lg }}>{title}</Text> : null}
                    {children}
                </View>
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
        <Sheet visible={visible} onClose={busy ? () => { } : onClose} title={title}>
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
    grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.lg },
    toast: { position: 'absolute', left: spacing.lg, right: spacing.lg, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
});
