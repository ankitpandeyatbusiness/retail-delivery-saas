// src/components/ui/dialog.jsx
import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import { create } from 'zustand';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { tint } from './shop';
import { Press } from './cartParts';

const useDlg = create(() => ({ cur: null }));
let queue = [];
const show = (d) => { if (useDlg.getState().cur) queue.push(d); else useDlg.setState({ cur: d }); };
const next = () => useDlg.setState({ cur: queue.shift() || null });

// Same arguments as Alert.alert(title, message, [{ text, style, onPress }]) so it is a drop-in replacement.
export function themedAlert(title, message, buttons, opts = {}) {
    show({ id: Math.random(), title, message, icon: opts.icon, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] });
}

// const ok = await ask({ title, message, confirmText, cancelText, destructive, icon })
export const ask = (o) => new Promise((res) => show({
    id: Math.random(), title: o.title, message: o.message, icon: o.icon,
    buttons: [
        { text: o.cancelText || 'Cancel', style: 'cancel', onPress: () => res(false) },
        { text: o.confirmText || 'OK', style: o.destructive ? 'destructive' : 'default', onPress: () => res(true) },
    ],
    onClose: () => res(false),
}));

function Card({ d }) {
    const { primary, text, muted, surface, border, error, radius } = useBrand();
    const v = useRef(new Animated.Value(0)).current;
    useEffect(() => { Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
    const bad = d.buttons.some((b) => b.style === 'destructive');
    const icon = d.icon || (bad ? 'alert-circle-outline' : 'help-circle-outline');
    const accent = bad ? error : primary;

    const done = (b) => {
        Animated.timing(v, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
            next();
            if (b?.onPress) b.onPress();
            else if (!b && d.onClose) d.onClose();
        });
    };
    const cancelBtn = d.buttons.find((b) => b.style === 'cancel');
    const row = d.buttons.length <= 2;

    return (
        <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => done(cancelBtn)}>
            <View style={s.wrap}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.backdrop, { opacity: v }]} />
                <Pressable style={StyleSheet.absoluteFill} onPress={() => done(cancelBtn)} />
                <Animated.View style={[s.card, { backgroundColor: surface, borderColor: border, opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
                    <View style={[s.ic, { backgroundColor: tint(accent) }]}><Ionicons name={icon} size={26} color={accent} /></View>
                    <Text style={[s.title, { color: text }]}>{d.title}</Text>
                    {d.message ? <Text style={[s.msg, { color: muted }]}>{d.message}</Text> : null}
                    <View style={[s.btns, row && s.btnsRow]}>
                        {d.buttons.map((b, i) => {
                            const ghost = b.style === 'cancel';
                            const fill = b.style === 'destructive' ? error : primary;
                            return (
                                <Press key={i} wrap={row ? { flex: 1, marginLeft: i ? 10 : 0 } : { marginTop: i ? 8 : 0 }} onPress={() => done(b)}
                                    style={[s.btn, { borderRadius: radius }, ghost ? { borderWidth: 1.5, borderColor: border } : { backgroundColor: fill }]}>
                                    <Text style={[s.btnTxt, { color: ghost ? text : '#FFFFFF' }]}>{b.text}</Text>
                                </Press>
                            );
                        })}
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
}

export function DialogHost() {
    const cur = useDlg((st) => st.cur);
    return cur ? <Card key={cur.id} d={cur} /> : null;
}

const s = StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
    backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
    card: { width: '100%', maxWidth: 360, borderRadius: 22, borderWidth: 1, padding: 22, alignItems: 'center' },
    ic: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    title: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
    msg: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
    btns: { alignSelf: 'stretch', marginTop: 20 },
    btnsRow: { flexDirection: 'row' },
    btn: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
    btnTxt: { fontSize: 14, fontWeight: '800' },
});