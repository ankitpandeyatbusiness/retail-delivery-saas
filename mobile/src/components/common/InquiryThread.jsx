// The conversation on an inquiry, shared by the owner's and the customer's screens: the answers the customer gave, the message bubbles, and the reply box.
import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { Field, Button } from '../owners/ui';
import { tr } from '../../i18n';

export const STATUS_LABEL = { new: 'New', replied: 'Replied', quoted: 'Price sent', confirmed: 'Confirmed', rejected: 'Not possible', closed: 'Closed' };

export const answerText = (a) => (Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? tr('Yes') : tr('No')) : String(a.value));

// what the customer filled in, as "Question: answer" lines
export function Answers({ answers = [], estimate }) {
    const { text, muted } = useBrand();
    return (
        <View>
            {answers.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', marginTop: 4 }}>
                    <Text style={{ color: muted, fontSize: 13, flex: 2 }}>{a.label}</Text>
                    <Text style={{ color: text, fontSize: 14, fontWeight: '700', flex: 3 }}>{answerText(a)}</Text>
                </View>
            ))}
            {estimate ? <Text style={{ color: text, fontWeight: '800', marginTop: 8 }}>{tr('Estimate: about ₹{n}', { n: estimate })}</Text> : null}
        </View>
    );
}

// side: 'owner' | 'customer' = whose phone this is; those messages sit on the right
export function Bubbles({ messages = [], side }) {
    const { text, muted, primary, onPrimary, surface, border } = useBrand();
    return (
        <View style={{ marginTop: 6 }}>
            {messages.map((m, i) => {
                const mine = m.from === side;
                return (
                    <View key={i} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 8 }}>
                        <View style={{ backgroundColor: mine ? primary : surface, borderWidth: mine ? 0 : 1, borderColor: border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
                            <Text style={{ color: mine ? onPrimary : text, fontSize: 15 }}>{m.text}</Text>
                        </View>
                        <Text style={{ color: muted, fontSize: 10, marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>{new Date(m.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                );
            })}
            {!messages.length ? <Text style={{ color: muted, textAlign: 'center', marginVertical: 10 }}>{tr('No messages yet')}</Text> : null}
        </View>
    );
}

// the box at the bottom. onSend(text) returns a promise; the box clears when it works.
export function ReplyBox({ onSend, placeholder }) {
    const { primary, onPrimary } = useBrand();
    const [v, setV] = useState('');
    const [busy, setBusy] = useState(false);
    const go = async () => {
        const t = v.trim();
        if (!t || busy) return;
        setBusy(true);
        try { await onSend(t); setV(''); } finally { setBusy(false); }
    };
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ flex: 1, marginRight: 8 }}><Field value={v} onChangeText={setV} placeholder={placeholder || tr('Write a message')} multiline maxLength={1000} style={{ minHeight: 46, maxHeight: 110 }} /></View>
            <Pressable onPress={go} disabled={busy || !v.trim()} accessibilityRole="button" accessibilityLabel={tr('Send')}
                style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', opacity: !v.trim() ? 0.45 : 1 }}>
                {busy ? <ActivityIndicator color={onPrimary} size="small" /> : <Ionicons name="send" size={20} color={onPrimary} style={{ marginLeft: 2 }} />}
            </Pressable>
        </View>
    );
}
