// "Chat with the shop" / "Chat with the customer": opens the chat of one bulk order, inquiry or booking. The red number = unread messages.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from './kit';
import { useChatStore, unreadOf } from '../../store/common/useChatStore';
import { tr } from '../../i18n';

export default function ChatButton({ kind, refId, title, label, style }) {
    const nav = useNavigation();
    const { primary, text, border, surface, error } = useBrand();
    const n = useChatStore(unreadOf(kind, refId));
    return (
        <Pressable onPress={() => nav.navigate('Chat', { kind, refId: String(refId), title })} accessibilityRole="button" style={[{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: primary, backgroundColor: surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 54 }, style]}>
            <Ionicons name="chatbubbles-outline" size={22} color={primary} />
            <Text style={{ flex: 1, marginLeft: 10, color: text, fontWeight: '800', fontSize: 15 }}>{label}</Text>
            {n > 0 ? <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: error, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 12 }}>{n > 99 ? '99+' : n}</Text></View> : <Ionicons name="chevron-forward" size={18} color={border} />}
        </Pressable>
    );
}

// a small unread badge for a list card
export function ChatBadge({ kind, refId }) {
    const { error } = useBrand();
    const n = useChatStore(unreadOf(kind, refId));
    if (!n) return null;
    return <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: error, borderRadius: 11, paddingHorizontal: 7, height: 22, marginLeft: 6 }}><Ionicons name="chatbubble" size={11} color="#fff" /><Text style={{ color: '#fff', fontWeight: '900', fontSize: 11.5, marginLeft: 4 }}>{n > 99 ? '99+' : n}</Text></View>;
}
