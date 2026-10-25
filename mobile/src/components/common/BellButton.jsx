// The bell with its unread dot: opens the person's notification list. For the cook, the waiter and the rider (the owner and the customer have their own).
import React from 'react';
import { View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from './kit';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { tr } from '../../i18n';

export default function BellButton({ style }) {
    const nav = useNavigation();
    const { text, error } = useBrand();
    const unread = useNotificationStore((s) => s.unread);
    return (
        <Pressable onPress={() => nav.navigate('Notifications')} hitSlop={10} style={[{ padding: 6, marginLeft: 6 }, style]} accessibilityRole="button" accessibilityLabel={tr('Notifications')}>
            <Ionicons name="notifications-outline" size={24} color={text} />
            {unread > 0 ? <View style={{ position: 'absolute', top: 5, right: 5, width: 10, height: 10, borderRadius: 5, backgroundColor: error, borderWidth: 1.5, borderColor: '#FFFFFF' }} /> : null}
        </Pressable>
    );
}
