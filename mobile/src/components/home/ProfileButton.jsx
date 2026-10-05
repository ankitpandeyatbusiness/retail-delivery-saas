import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/useAuthStore';

export default function ProfileButton() {
    const navigation = useNavigation();
    const user = useAuthStore((s) => s.user);
    const logout = useAuthStore((s) => s.logout);

    const onPress = () => (user ? logout() : navigation.navigate('Login'));

    return (
        <Pressable onPress={onPress} style={styles.button} hitSlop={8}>
            <Text style={styles.text}>{user ? 'Log out' : 'Log in'}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#F2F2F2' },
    text: { fontSize: 13, fontWeight: '600', color: '#333333' },
});